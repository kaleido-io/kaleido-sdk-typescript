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

// Event source and event processor patterns that custom providers written
// against 1.0.1 use. These are only type-checked, never run.

import type { SetupContext } from '@kaleido-io/core-sdk/context';
import {
  EngineAPI,
  EventProcessor,
  EventProcessorContext,
  EventProcessorDef,
  EventProcessorEvent,
  EventSource,
  EventSourceConf,
  EventSourceEvent,
  EventSourcePollFn,
  ListenerEvent,
  RequestContext,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
  WSEventSourceConfig,
  WSEventStreamInfo,
  WSListenerPollRequest,
  WSListenerPollResult,
  WSMessageType,
  createEventProcessor,
  createEventSource,
} from '@kaleido-io/workflow-engine-sdk';

interface TickConfig { intervalMs: number }
interface TickCheckpoint { last: number }
interface TickData { at: number }

// A poll function declared with its own explicit type, using the authRef.
const pollTicks: EventSourcePollFn<TickCheckpoint, TickConfig, TickData> = async (conf, checkpoint, authRef) => {
  const now = Date.now();
  const last = checkpoint?.last ?? 0;
  const events: EventSourceEvent<TickData>[] = now - last >= conf.config.intervalMs
    ? [{ idempotencyKey: `${conf.streamId}-${now}-${authRef ?? ''}`, topic: conf.streamName, data: { at: now } }]
    : [];
  return { checkpointOut: { last: events.length ? now : last }, events };
};

export const ticks = createEventSource('ticks', pollTicks)
  .withInitialCheckpoint(async (config) => ({ last: config.intervalMs }))
  .withConfigParser(async (info: WSEventStreamInfo, raw: { intervalMs?: number }) => ({ intervalMs: raw.intervalMs ?? info.streamName.length }))
  .withDeleteFn(async () => {})
  .withInitFn(async (_engAPI: EngineAPI) => {})
  .withCloseFn(() => {});

// A two-parameter inline poll function, as the samples write it.
export const inline = createEventSource<TickCheckpoint, TickConfig, TickData>(
  'inline',
  async (conf: EventSourceConf<TickConfig>, checkpoint: TickCheckpoint | null) => ({
    checkpointOut: checkpoint ?? { last: conf.config.intervalMs },
    events: [],
  }),
);

// An EventSource written from scratch, without the factory.
export class RawEventSource implements EventSource {
  readonly name = 'raw-source';
  async init(): Promise<void> {}
  close(): void {}
  async eventSourcePoll(reqContext: RequestContext, config: WSEventSourceConfig, result: WSListenerPollResult, request: WSListenerPollRequest): Promise<void> {
    const event: ListenerEvent = { idempotencyKey: `${request.streamId}-${reqContext.requestId}`, topic: config.streamName, data: request.checkpoint };
    result.events = [event];
    result.checkpoint = { authRef: request.authRef };
  }
  async eventSourceValidateConfig(_reqContext: RequestContext, result: any, request: any): Promise<void> {
    result.initialCheckpoint = request.config;
  }
  async eventSourceDelete(): Promise<void> {}
}

// An EventProcessor written from scratch, for the low-level registration API.
export class RawEventProcessor implements EventProcessor {
  readonly name = 'raw-processor';
  async init(): Promise<void> {}
  close(): void {}
  async eventProcessorBatch(reqContext: RequestContext, result: WSEventProcessorBatchResult, batch: WSEventProcessorBatchRequest): Promise<void> {
    if (batch.events.length === 0 || !reqContext.authRef) {
      result.error = 'nothing to do';
    }
  }
}

interface StoreConfig { table: string }

// An event processor definition with a setup hook, from the factory and as a literal.
export const store = createEventProcessor<StoreConfig, TickData>(
  async (ctx, events) => {
    const options = ctx.getServiceClientOptions('asset-manager');
    void [options, ctx.config.table, ctx.requestId, ctx.signal, ctx.providerName, ctx.handlerName, events[0]?.data.at];
  },
  async (ctx: SetupContext<StoreConfig>) => {
    void ctx.getServiceClientOptions('asset-manager');
  },
);

export const storeLiteral: EventProcessorDef<StoreConfig, TickData> = {
  setup: async (ctx) => { void ctx.config.table; },
  processBatch: async (ctx: EventProcessorContext<StoreConfig>, events: EventProcessorEvent<TickData>[]) => {
    void [ctx.requestId, events.length];
  },
};

// What unit tests in custom providers do: build contexts and wire messages by
// hand and call the handlers directly.
export async function unitTestPatterns(): Promise<void> {
  const controller = new AbortController();
  const reqContext: RequestContext = { requestId: 'r1', signal: controller.signal, cancel: () => controller.abort() };

  // Call a poll function with the two arguments the samples' tests pass.
  const polled = await pollTicks({ streamId: 's1', streamName: 'n1', config: { intervalMs: 1 } }, null);
  const polledWithAuth = await pollTicks({ streamId: 's1', streamName: 'n1', config: { intervalMs: 1 } }, polled.checkpointOut, 'a1');

  // Drive a factory event source with hand-built wire messages.
  const config: WSEventSourceConfig = { messageType: WSMessageType.EVENT_SOURCE_CONFIG, id: 'c1', streamId: 's1', streamName: 'n1', config: { intervalMs: 1 } };
  const request: WSListenerPollRequest = { messageType: WSMessageType.EVENT_SOURCE_POLL, id: 'p1', streamId: 's1', streamName: 'n1', checkpoint: null, authRef: 'a1' };
  const result: WSListenerPollResult = { messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT, id: 'p1', events: [] };
  await ticks.eventSourcePoll(reqContext, config, result, request);
  await ticks.eventSourceValidateConfig(reqContext, {}, { streamId: 's1', streamName: 'n1', config: {} });
  await ticks.eventSourceDelete(reqContext, { messageType: WSMessageType.EVENT_SOURCE_DELETE_RESULT, id: 'd1' }, { streamId: 's1' });

  // Build an event processor context literal and call processBatch, as the indexer tests do.
  const ctx: EventProcessorContext<StoreConfig> = {
    config: { table: 't' },
    providerName: 'p',
    handlerName: 'store',
    signal: controller.signal,
    requestId: 'r1',
    getServiceClientOptions: () => ({ transport: 'http', url: 'http://localhost' }),
  };
  await store.processBatch(ctx, [{ idempotencyKey: 'k', topic: 't', data: { at: 1 } }]);
  const setupCtx: SetupContext<StoreConfig> = ctx;
  await store.setup!(setupCtx);

  void [polledWithAuth];
}
