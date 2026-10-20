// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Records the replies a real WorkflowEngineClient sends for event-source and
// event-processor requests, and compares them with the expected messages recorded
// on 1.0.1.

import { mockLogger } from '../mock-logger';
import { afterAll, beforeAll, describe, it } from '@jest/globals';
import { createServiceTransport } from '@kaleido-io/core-sdk/http';

import {
  EventProcessor,
  RequestContext,
  WorkflowEngineClient,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
  createEventSource,
} from '../../src/index';
import { FakeEngine, WireMessage } from './fixtures/fake-engine';
import { expectToMatchExpectedMessages } from './helpers/expected-data-helper';

void mockLogger;

interface TickConfig { interval: number; fail?: boolean }
interface TickCheckpoint { n: number }

const ticker = createEventSource<TickCheckpoint, TickConfig, unknown>('ticker', async (conf, checkpoint, authRef) => {
  if (conf.config.fail) {
    throw new Error(`poll failed for ${conf.streamId}`);
  }
  const n = (checkpoint?.n ?? 0) + 1;
  return {
    checkpointOut: { n },
    events: [{
      idempotencyKey: `${conf.streamId}-${n}`,
      topic: `${conf.streamName}-tick`,
      data: { streamId: conf.streamId, streamName: conf.streamName, config: conf.config, checkpointIn: checkpoint, authRef: authRef ?? null },
    }],
  };
})
  .withConfigParser(async (info, raw: { interval?: number; invalid?: boolean; fail?: boolean }) => {
    if (raw?.invalid) {
      throw new Error(`invalid config for ${info.streamName}`);
    }
    return { interval: raw?.interval ?? 1, fail: raw?.fail };
  })
  .withInitialCheckpoint(async (config) => ({ n: config.interval * 100 }))
  .withDeleteFn(async (info) => {
    if (info.streamName === 'undeletable') {
      throw new Error('cannot delete');
    }
  });

// A source with no optional hooks at all.
const bare = createEventSource<TickCheckpoint, unknown, unknown>('bare', async (_conf, checkpoint) => ({ checkpointOut: checkpoint ?? { n: 0 }, events: [] }));

// An event processor written against the raw interface.
class RawProcessor implements EventProcessor {
  readonly name = 'raw-processor';
  seen: Record<string, unknown>[] = [];
  async init(): Promise<void> {}
  close(): void {}
  async eventProcessorBatch(reqContext: RequestContext, result: WSEventProcessorBatchResult, batch: WSEventProcessorBatchRequest): Promise<void> {
    this.seen.push({ requestId: reqContext.requestId, authRef: reqContext.authRef ?? null, events: batch.events.length, streamId: batch.streamId, streamName: batch.streamName });
    if (batch.events.some((e) => (e.data as { fail?: boolean })?.fail)) {
      result.error = 'raw processor rejected the batch';
    }
  }
}

const poll = (id: string, streamId: string, extra: Record<string, unknown> = {}) => ({
  messageType: 'event_source_poll', id, handler: 'ticker', streamId, streamName: `name-${streamId}`, ...extra,
});
const configFor = (streamId: string, config: unknown, streamName = `name-${streamId}`) => ({
  messageType: 'event_source_config', id: `cfg-${streamId}`, handler: 'ticker', streamId, streamName, config,
});

describe('backwards compatibility: event source wire replies', () => {
  const engine = new FakeEngine();
  let client: WorkflowEngineClient;

  beforeAll(async () => {
    await engine.start();
    client = new WorkflowEngineClient({ providerName: 'compat-provider', url: engine.url, maxAttempts: 1 });
    client.registerEventSource('ticker', ticker);
    client.registerEventSource('bare', bare);
    await client.connect();
    await engine.waitForRegistration(2);
  });

  afterAll(async () => {
    client.stop();
    await engine.close();
  });

  it('matches the recorded replies', async () => {
    const steps: { step: string; send: WireMessage; expectsReply: boolean }[] = [
      { step: 'validate-with-initial-checkpoint', send: { messageType: 'event_source_validate_config', id: 'v1', handler: 'ticker', streamId: 's1', streamName: 'name-s1', config: { interval: 3 } }, expectsReply: true },
      { step: 'validate-parser-throws', send: { messageType: 'event_source_validate_config', id: 'v2', handler: 'ticker', streamId: 's1', streamName: 'name-s1', config: { invalid: true } }, expectsReply: true },
      { step: 'validate-no-initial-checkpoint', send: { messageType: 'event_source_validate_config', id: 'v3', handler: 'bare', streamId: 's9', streamName: 'name-s9', config: {} }, expectsReply: true },
      { step: 'validate-unknown-handler', send: { messageType: 'event_source_validate_config', id: 'v4', handler: 'nope', streamId: 's1', streamName: 'name-s1', config: {} }, expectsReply: true },
      { step: 'config-s1', send: configFor('s1', { interval: 5 }), expectsReply: false },
      { step: 'poll-first', send: poll('p1', 's1', { authRef: 'auth-poll-1' }), expectsReply: true },
      { step: 'poll-with-checkpoint', send: poll('p2', 's1', { checkpoint: { n: 1 }, authRef: 'auth-poll-2' }), expectsReply: true },
      { step: 'poll-no-auth-ref', send: poll('p3', 's1', { checkpoint: { n: 2 } }), expectsReply: true },
      { step: 'poll-without-config', send: poll('p4', 's2'), expectsReply: true },
      { step: 'poll-unknown-handler', send: { ...poll('p5', 's1'), handler: 'nope' }, expectsReply: true },
      { step: 'config-s3-failing', send: configFor('s3', { fail: true }), expectsReply: false },
      { step: 'poll-throws', send: poll('p6', 's3'), expectsReply: true },
      // The parsed config is cached per stream on the first poll, so a later config message for the same stream isn't seen by the poll function.
      { step: 'config-s1-updated', send: configFor('s1', { interval: 9 }), expectsReply: false },
      { step: 'poll-after-config-update', send: poll('p7', 's1', { checkpoint: { n: 3 } }), expectsReply: true },
      { step: 'delete-s1', send: { messageType: 'event_source_delete', id: 'd1', handler: 'ticker', streamId: 's1', streamName: 'name-s1' }, expectsReply: true },
      { step: 'poll-after-delete', send: poll('p8', 's1'), expectsReply: true },
      { step: 'delete-throws', send: { messageType: 'event_source_delete', id: 'd2', handler: 'ticker', streamId: 's4', streamName: 'undeletable' }, expectsReply: true },
      { step: 'delete-unknown-handler', send: { messageType: 'event_source_delete', id: 'd3', handler: 'nope', streamId: 's1', streamName: 'name-s1' }, expectsReply: true },
    ];
    const recording = [];
    for (const { step, send, expectsReply } of steps) {
      if (expectsReply) {
        recording.push({ step, sent: send, reply: await engine.request(send) });
      } else {
        engine.send(send);
        recording.push({ step, sent: send });
      }
    }
    expectToMatchExpectedMessages('event-sources', recording);
  });
});

describe('backwards compatibility: event processor wire replies', () => {
  const engine = new FakeEngine({
    onServiceProxyRequest: (msg) => msg.request.path.includes('/unavailable')
      ? { status: 503, error: 'service unavailable' }
      : { status: 200, body: { items: [{ id: 'pool-1' }] } },
  });
  let client: WorkflowEngineClient<{ table: string }>;
  const raw = new RawProcessor();
  const observed: Record<string, unknown>[] = [];

  beforeAll(async () => {
    await engine.start();
    client = new WorkflowEngineClient<{ table: string }>({
      providerName: 'compat-provider',
      url: engine.url,
      maxAttempts: 1,
      serviceBindings: {
        'asset-manager': { bindingType: 'hosted', serviceType: 'AssetManagerService', id: 's-am' },
      },
    }, { table: 'balances' })
      .eventProcessor<{ table: string }, { call?: string; fail?: boolean }>('indexer', {
        processBatch: async (ctx, events) => {
          const results: unknown[] = [];
          for (const event of events) {
            if (event.data.call) {
              results.push(await createServiceTransport(ctx.getServiceClientOptions('asset-manager')).get(event.data.call, { limit: 1 }));
            }
            if (event.data.fail) {
              throw new Error(`indexer failed on ${event.idempotencyKey}`);
            }
          }
          observed.push({
            config: ctx.config,
            providerName: ctx.providerName,
            handlerName: ctx.handlerName,
            requestId: ctx.requestId,
            aborted: ctx.signal.aborted,
            events,
            results,
          });
        },
      });
    client.registerEventProcessor('raw-processor', raw);
    await client.start();
    await engine.waitForRegistration(2);
  });

  afterAll(async () => {
    client.stop();
    await engine.close();
  });

  const batch = (id: string, handler: string, events: unknown[], extra: Record<string, unknown> = {}) => ({
    messageType: 'event_processor_batch', id, handler, streamId: 'stream-1', streamName: 'stream-one', events, ...extra,
  });

  it('matches the recorded replies', async () => {
    const steps: { step: string; send: WireMessage }[] = [
      { step: 'builder-success', send: batch('e1', 'indexer', [{ idempotencyKey: 'k1', topic: 't', data: {} }, { idempotencyKey: 'k2', topic: 't', data: { n: 2 } }], { authRef: 'auth-e1' }) },
      { step: 'builder-hosted-call', send: batch('e2', 'indexer', [{ idempotencyKey: 'k3', topic: 't', data: { call: '/api/v1/pools' } }], { authRef: 'auth-e2' }) },
      { step: 'builder-hosted-call-no-auth-ref', send: batch('e3', 'indexer', [{ idempotencyKey: 'k4', topic: 't', data: { call: '/api/v1/pools' } }]) },
      { step: 'builder-hosted-call-fails', send: batch('e4', 'indexer', [{ idempotencyKey: 'k5', topic: 't', data: { call: '/api/v1/unavailable' } }], { authRef: 'auth-e4' }) },
      { step: 'builder-throws', send: batch('e5', 'indexer', [{ idempotencyKey: 'k6', topic: 't', data: { fail: true } }], { authRef: 'auth-e5' }) },
      { step: 'builder-empty-batch', send: batch('e6', 'indexer', []) },
      { step: 'raw-success', send: batch('e7', 'raw-processor', [{ idempotencyKey: 'k7', topic: 't', data: {} }], { authRef: 'auth-e7' }) },
      { step: 'raw-sets-error', send: batch('e8', 'raw-processor', [{ idempotencyKey: 'k8', topic: 't', data: { fail: true } }]) },
      { step: 'unknown-processor', send: batch('e9', 'nope', [{ idempotencyKey: 'k9', topic: 't', data: {} }]) },
    ];
    const recording = [];
    for (const { step, send } of steps) {
      recording.push({ step, sent: send, reply: await engine.request(send) });
    }
    expectToMatchExpectedMessages('event-processors', {
      replies: recording,
      builderContextSeen: observed,
      rawRequestContextSeen: raw.seen,
      serviceProxyRequests: engine.ofType('service-proxy-request'),
    });
  });
});
