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

import { describe, it, expect, jest } from '@jest/globals';
import { WorkflowEngineClient } from '../client/client.js';
import type { EventSource } from '../interfaces/handlers.js';
import type { ServiceBindingsMap } from '../service/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BindingMap = Record<string, { type: string; bindingType: 'non-hosted'; url: string; auth: Record<string, unknown> }>;

const singleAMBindings: BindingMap = {
  'asset-manager': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am', auth: {} },
};

function makeTestClient<C>(config: C = {} as C, bindings: BindingMap = singleAMBindings) {
  const client = WorkflowEngineClient._createForTest(config);
  jest.spyOn(client, 'connect').mockResolvedValue(undefined);
  jest.spyOn(client, 'disconnect').mockImplementation(() => {});
  jest.spyOn(client, 'registerEventProcessor').mockImplementation(() => {});
  jest.spyOn(client, 'registerTransactionHandler').mockImplementation(() => {});
  jest.spyOn(client, 'registerEventSource').mockImplementation(() => {});
  jest.spyOn(client, 'getServiceBindings').mockReturnValue(bindings as unknown as ServiceBindingsMap);
  jest.spyOn(client, 'getServiceClientOptions').mockImplementation((name) => {
    const b = (bindings as BindingMap)[name];
    if (!b) throw new Error(`Binding '${name}' not found`);
    return { transport: 'http', url: b.url, auth: b.auth as never };
  });
  return client;
}

// ---------------------------------------------------------------------------
// SetupContext
// ---------------------------------------------------------------------------

describe('SetupContext via WorkflowEngineClient', () => {
  it('surfaces config, providerName, handlerName via setup hook', async () => {
    const client = makeTestClient({ foo: 1 });
    let capturedCtx: Record<string, unknown> | undefined;
    client.indexer('my-handler', {
      setup: async (ctx) => { capturedCtx = ctx as never; },
      indexBatch: async (_ctx, _events) => {},
    });
    await client.start();
    expect(capturedCtx!['config']).toEqual({ foo: 1 });
    expect(capturedCtx!['providerName']).toBe('test-provider');
    expect(capturedCtx!['handlerName']).toBe('my-handler');
  });

  it('getServiceClientOptions resolves from bindings', async () => {
    const client = makeTestClient({});
    let opts: Record<string, unknown> | undefined;
    client.indexer('h', {
      setup: async (ctx) => { opts = ctx.getServiceClientOptions('asset-manager') as never; },
      indexBatch: async (_ctx, _events) => {},
    });
    await client.start();
    expect(opts).toMatchObject({ transport: 'http', url: 'http://am' });
  });
});

// ---------------------------------------------------------------------------
// Builder — uniqueness + handler types
// ---------------------------------------------------------------------------

describe('WorkflowEngineClient builder', () => {
  it('throws on duplicate handler name', () => {
    const client = makeTestClient({});
    const noop = { indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
    client.indexer('my-handler', noop);
    expect(() => client.indexer('my-handler', noop)).toThrow("Handler 'my-handler' is already registered");
  });

  it('throws on duplicate name across handler types', () => {
    const client = makeTestClient({});
    client.indexer('shared', { indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
    expect(() =>
      client.transactionHandler('shared', {
        handler: { name: 'shared', init: jest.fn() as never, close: jest.fn() as never, transactionHandlerBatch: jest.fn() as never },
      }),
    ).toThrow("Handler 'shared' is already registered");
  });

  it('calls setup hook after connect on start()', async () => {
    const client = makeTestClient({});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.indexer('idx', { setup: setupFn, indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(setupFn).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    const setupOrder = (setupFn.mock.invocationCallOrder ?? [])[0]!;
    const connectOrder = ((client.connect as jest.Mock).mock.invocationCallOrder ?? [])[0]!;
    // Setup runs after connect so hosted ws-proxy bindings have an established
    // WebSocket before setup() tries to call platform services.
    expect(setupOrder).toBeGreaterThan(connectOrder);
  });

  it('setup() calls setup hooks but does NOT call connect', async () => {
    const client = makeTestClient({});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.indexer('idx', { setup: setupFn, indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.setup();

    expect(setupFn).toHaveBeenCalledTimes(1);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('setupLifecycle=deferred: start() skips boot-time setup hooks', async () => {
    const client = WorkflowEngineClient._createForTest({}, { providerName: 'test-provider', setupLifecycle: 'deferred' });
    jest.spyOn(client, 'connect').mockResolvedValue(undefined);
    jest.spyOn(client, 'disconnect').mockImplementation(() => {});
    jest.spyOn(client, 'registerEventProcessor').mockImplementation(() => {});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.indexer('idx', { setup: setupFn, indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(setupFn).not.toHaveBeenCalled();
  });

  it('runSetupOnTrigger runs setup hooks and exposes authRef via SetupContext', async () => {
    const client = makeTestClient({}, {
      'asset-manager': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am', auth: {} },
    });
    let capturedAuthRef: string | undefined;
    const setupFn = jest.fn(async (ctx: any) => {
      capturedAuthRef = ctx.getServiceClientOptions('asset-manager').authRef;
    });
    client.indexer('idx', { setup: setupFn as never, indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
    // No start() — we exercise the trigger callback directly.
    // Override the binding-lookup mock so the real getServiceClientOptions runs and surfaces authRef.
    (client.getServiceClientOptions as unknown as jest.Mock).mockImplementation(
      (...args: unknown[]) => ({ transport: 'http', url: 'http://am', auth: {}, authRef: args[1] }) as never,
    );

    const result = await client.runSetupOnTrigger('admin-authref-xyz');

    expect(setupFn).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(capturedAuthRef).toBe('admin-authref-xyz');
  });

  it('runSetupOnTrigger collects errors and returns error status', async () => {
    const client = makeTestClient({});
    const setupFn = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('boom'));
    client.indexer('idx', { setup: setupFn, indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    const result = await client.runSetupOnTrigger('a');

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['idx: boom']);
  });

  it('registers event processor on start()', async () => {
    const client = makeTestClient({});
    client.indexer('my-idx', { indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(client.registerEventProcessor).toHaveBeenCalledWith('my-idx', expect.anything());
  });

  it('registers event source on start()', async () => {
    const client = makeTestClient({});
    const mockSource = {
      name: 'my-source',
      init: jest.fn(), close: jest.fn(),
      eventSourcePoll: jest.fn(), eventSourceValidateConfig: jest.fn(), eventSourceDelete: jest.fn(),
    } as unknown as EventSource;

    client.eventSource(mockSource);
    await client.start();

    expect(client.registerEventSource).toHaveBeenCalledWith('my-source', mockSource);
  });

  it('stop() calls disconnect', async () => {
    const client = makeTestClient({});
    client.indexer('idx', { indexBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
    await client.start();
    client.stop();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('injects correct ctx into process callback', async () => {
    const client = makeTestClient({ key: 'value' });
    let capturedCtx: Record<string, unknown> | undefined;
    client.indexer('idx', {
      indexBatch: async (ctx, _events) => { capturedCtx = ctx as never; },
    });

    await client.start();

    const registeredProcessor = ((client.registerEventProcessor as jest.Mock).mock.calls[0]! as unknown[])[1] as { eventProcessorBatch: (...args: unknown[]) => Promise<unknown> };
    const batchResult = {};
    const reqSignal = new AbortController().signal;
    await registeredProcessor.eventProcessorBatch({ requestId: 'req-abc', signal: reqSignal }, batchResult, { events: [] });

    expect(capturedCtx!['requestId']).toBe('req-abc');
    expect(capturedCtx!['config']).toEqual({ key: 'value' });
    expect(capturedCtx!['handlerName']).toBe('idx');
    // The indexer context must carry the per-request signal (deadline/cancellation),
    // not a start-level signal that is never aborted.
    expect(capturedCtx!['signal']).toBe(reqSignal);
  });
});
