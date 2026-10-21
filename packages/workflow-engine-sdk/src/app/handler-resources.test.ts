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

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { WorkflowEngineClient } from '../client/client.js';
import { ConfigLoader } from '../config/config.js';
import type { EventProcessor, EventSource } from '../interfaces/handlers.js';
import type { HandlerRuntime } from '../runtime/handler_runtime.js';
import { WSMessageType, type WSEvaluateTransaction, type WSHandlerEnvelope } from '../types/core.js';
import { createEventSourceContext, createTransactionContext, type HandlerResources } from './context.js';
import { createTransactionHandler } from '../factories/transaction_handler.js';

interface Internals {
  runtime: Pick<HandlerRuntime, 'newRequestContext'> & { eventProcessors: Map<string, EventProcessor> };
}

function startedClient<C>(config: C, secrets?: Record<string, string>) {
  const client = WorkflowEngineClient._createForTest(config, { providerName: 'p', secrets });
  jest.spyOn(client, 'connect').mockResolvedValue(undefined);
  return client;
}

const envelope = (handler: string, messageType = WSMessageType.HANDLE_TRANSACTIONS): WSHandlerEnvelope => ({
  messageType,
  id: `req-${handler}`,
  handler,
});

const transaction = { authRef: 'a-1' } as WSEvaluateTransaction;

function resourcesOf(ctx: HandlerResources & { config: unknown }) {
  return { config: ctx.config, secrets: { ...ctx.secrets }, resources: { ...ctx.resources } };
}

describe('handler config, secrets and resources', () => {
  it('gives each registered handler its own, and the rest the client\'s', async () => {
    const client = startedClient({ shared: true }, { shared: 'provider-secret' });
    const noop = createTransactionHandler('x', new Map());
    client
      .transactionHandler('payments', { handler: noop }, {
        config: { book: 'primary' },
        secrets: { apiKey: 'payments-key' },
        resources: { truststore: '/etc/resources/payments/truststore.p12' },
      })
      .transactionHandler('refunds', { handler: noop }, {
        config: { book: 'secondary' },
        secrets: { apiKey: 'refunds-key' },
      })
      .transactionHandler('plain', { handler: noop });
    await client.start();
    const { runtime } = client as unknown as Internals;

    const ctxFor = (name: string) => createTransactionContext(runtime.newRequestContext(envelope(name)), name, transaction);

    expect(resourcesOf(ctxFor('payments'))).toEqual({
      config: { book: 'primary' },
      secrets: { apiKey: 'payments-key' },
      resources: { truststore: '/etc/resources/payments/truststore.p12' },
    });
    // No resources of its own, so the client's (none)
    expect(resourcesOf(ctxFor('refunds'))).toEqual({
      config: { book: 'secondary' },
      secrets: { apiKey: 'refunds-key' },
      resources: {},
    });
    expect(resourcesOf(ctxFor('plain'))).toEqual({
      config: { shared: true },
      secrets: { shared: 'provider-secret' },
      resources: {},
    });
  });

  it('applies to event sources and event processors too', async () => {
    const client = startedClient({ shared: true });
    const source = {
      name: 'feed',
      init: jest.fn(), close: jest.fn(),
      eventSourcePoll: jest.fn(), eventSourceValidateConfig: jest.fn(), eventSourceDelete: jest.fn(),
    } as unknown as EventSource;
    let processorCtx: (HandlerResources & { config: unknown }) | undefined;
    client
      .eventSource(source, { config: { book: 'feed-book' }, secrets: { token: 'feed-token' } })
      .eventProcessor('writer', {
        processBatch: async (ctx) => { processorCtx = ctx; },
      }, { config: { book: 'writer-book' }, resources: { schema: '/etc/resources/writer/schema.json' } });
    await client.start();
    const { runtime } = client as unknown as Internals;

    const sourceCtx = createEventSourceContext(
      runtime.newRequestContext(envelope('feed', WSMessageType.EVENT_SOURCE_POLL)),
      'feed',
      { streamId: 's1', streamName: 'n' } as never,
      undefined,
    );
    expect(resourcesOf(sourceCtx)).toEqual({ config: { book: 'feed-book' }, secrets: { token: 'feed-token' }, resources: {} });

    const processorReq = runtime.newRequestContext(envelope('writer', WSMessageType.EVENT_PROCESSOR_BATCH));
    await runtime.eventProcessors.get('writer')!.eventProcessorBatch(processorReq, {} as never, { events: [] } as never);
    expect(resourcesOf(processorCtx!)).toEqual({
      config: { book: 'writer-book' },
      secrets: {},
      resources: { schema: '/etc/resources/writer/schema.json' },
    });
    expect(processorCtx!.resource!('schema')).toBe('/etc/resources/writer/schema.json');
  });

  it('keeps a handler\'s secrets and resources read-only', async () => {
    const client = startedClient({});
    client.transactionHandler('h', { handler: createTransactionHandler('h', new Map()) }, {
      secrets: { apiKey: 'k' }, resources: { f: '/x' },
    });
    await client.start();
    const { runtime } = client as unknown as Internals;
    const ctx = createTransactionContext(runtime.newRequestContext(envelope('h')), 'h', transaction);
    expect(Object.isFrozen(ctx.secrets)).toBe(true);
    expect(Object.isFrozen(ctx.resources)).toBe(true);
  });

  it('names the handler\'s resources when asked for one it lacks', async () => {
    const client = startedClient({});
    client.transactionHandler('h', { handler: createTransactionHandler('h', new Map()) }, { resources: { a: '/a', b: '/b' } });
    await client.start();
    const { runtime } = client as unknown as Internals;
    const ctx = createTransactionContext(runtime.newRequestContext(envelope('h')), 'h', transaction);
    expect(() => ctx.resource!('c')).toThrow("Handler 'h' has no resource named 'c'. Its resources are: a, b");
  });

  it('uses the registered config in setup hooks', async () => {
    const client = startedClient({ shared: true });
    let setupConfig: unknown;
    client.eventProcessor('writer', {
      setup: async (ctx) => { setupConfig = ctx.config; },
      processBatch: async () => {},
    }, { config: { book: 'writer-book' } });
    await client.setup();
    expect(setupConfig).toEqual({ book: 'writer-book' });
  });
});

describe('ConfigLoader.loadSecretsDir', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads a key set as its name, and any other set\'s files as <set>/<file>', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    dirs.push(dir);
    // The layout Kubernetes projects a Secret volume into: timestamped data behind a ..data link
    const data = join(dir, '..2026_10_21_00_00_00.000');
    mkdirSync(join(data, 'apiKey'), { recursive: true });
    mkdirSync(join(data, 'smtp'), { recursive: true });
    writeFileSync(join(data, 'apiKey', 'value'), 'k-123');
    writeFileSync(join(data, 'smtp', 'username'), 'mailer');
    writeFileSync(join(data, 'smtp', 'password'), 'p@ss\n');
    symlinkSync(data, join(dir, '..data'));
    symlinkSync(join('..data', 'apiKey'), join(dir, 'apiKey'));
    symlinkSync(join('..data', 'smtp'), join(dir, 'smtp'));
    writeFileSync(join(dir, 'README'), 'a stray top-level file');

    expect(ConfigLoader.loadSecretsDir(dir)).toEqual({
      apiKey: 'k-123',
      'smtp/password': 'p@ss\n',
      'smtp/username': 'mailer',
    });
  });

  it('says which directory it couldn\'t read', () => {
    expect(() => ConfigLoader.loadSecretsDir('/no/such/secrets')).toThrow("Can't read the secrets directory '/no/such/secrets'");
  });
});
