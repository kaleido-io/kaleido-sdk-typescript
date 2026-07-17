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

type BindingMap = Record<string, { bindingType: 'non-hosted'; url: string; auth: Record<string, unknown> }>;

const singleAMBindings: BindingMap = {
  'asset-manager': { bindingType: 'non-hosted', url: 'http://am', auth: {} },
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
    client.eventProcessor('my-handler', {
      setup: async (ctx) => { capturedCtx = ctx as never; },
      processBatch: async (_ctx, _events) => {},
    });
    await client.setup();
    expect(capturedCtx!['config']).toEqual({ foo: 1 });
    expect(capturedCtx!['providerName']).toBe('test-provider');
    expect(capturedCtx!['handlerName']).toBe('my-handler');
  });

  it('getServiceClientOptions resolves from bindings', async () => {
    const client = makeTestClient({});
    let opts: Record<string, unknown> | undefined;
    client.eventProcessor('h', {
      setup: async (ctx) => { opts = ctx.getServiceClientOptions('asset-manager') as never; },
      processBatch: async (_ctx, _events) => {},
    });
    await client.setup();
    expect(opts).toMatchObject({ transport: 'http', url: 'http://am' });
  });
});

// ---------------------------------------------------------------------------
// Builder — uniqueness + handler types
// ---------------------------------------------------------------------------

describe('WorkflowEngineClient builder', () => {
  it('throws on duplicate handler name', () => {
    const client = makeTestClient({});
    const noop = { processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
    client.eventProcessor('my-handler', noop);
    expect(() => client.eventProcessor('my-handler', noop)).toThrow("Handler 'my-handler' is already registered");
  });

  it('throws on duplicate name across handler types', () => {
    const client = makeTestClient({});
    client.eventProcessor('shared', { processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
    expect(() =>
      client.transactionHandler('shared', {
        handler: { name: 'shared', init: jest.fn() as never, close: jest.fn() as never, transactionHandlerBatch: jest.fn() as never },
      }),
    ).toThrow("Handler 'shared' is already registered");
  });

  it('start() with only non-hosted bindings runs setup hooks at boot', async () => {
    // Non-hosted transports carry their own credentials, so setup can safely
    // run without an authRef. Preserves today's dev-loop behaviour for local
    // and non-hosted deployments.
    const client = WorkflowEngineClient._createForTest({}, {
      providerName: 'test-provider',
      serviceBindings: { 'am': { bindingType: 'non-hosted', url: 'http://am', auth: { type: 'basic', username: 'u', password: 'p' } } },
    });
    jest.spyOn(client, 'connect').mockResolvedValue(undefined);
    jest.spyOn(client, 'registerEventProcessor').mockImplementation(() => {});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.eventProcessor('ep', { setup: setupFn, processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(setupFn).toHaveBeenCalledTimes(1);
    const setupOrder = (setupFn.mock.invocationCallOrder ?? [])[0]!;
    const connectOrder = ((client.connect as jest.Mock).mock.invocationCallOrder ?? [])[0]!;
    expect(setupOrder).toBeGreaterThan(connectOrder);
  });

  it('start() with a hosted binding defers setup until SETUP_TRIGGER_REQUEST', async () => {
    // Hosted bindings inject a per-request authRef sourced from a user JWT.
    // At boot there is no such JWT in scope, so setup MUST wait for the proxy
    // to dispatch SETUP_TRIGGER_REQUEST with a valid authRef.
    const client = WorkflowEngineClient._createForTest({}, {
      providerName: 'test-provider',
      serviceBindings: { 'am': { serviceType: 'AssetManagerService', bindingType: 'hosted', id: 's:am' } },
    });
    jest.spyOn(client, 'connect').mockResolvedValue(undefined);
    jest.spyOn(client, 'registerEventProcessor').mockImplementation(() => {});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.eventProcessor('ep', { setup: setupFn, processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(setupFn).not.toHaveBeenCalled();
  });

  it('setup() calls setup hooks but does NOT call connect', async () => {
    // Explicit setup() bypasses the trigger dispatch — useful for init-container
    // or non-hosted usage where no proxy is in the picture.
    const client = makeTestClient({});
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    client.eventProcessor('ep', { setup: setupFn, processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.setup();

    expect(setupFn).toHaveBeenCalledTimes(1);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('runSetupOnTrigger runs setup hooks and exposes authRef via SetupContext', async () => {
    const client = makeTestClient({}, {
      'asset-manager': { bindingType: 'non-hosted', url: 'http://am', auth: {} },
    });
    let capturedAuthRef: string | undefined;
    const setupFn = jest.fn(async (ctx: any) => {
      capturedAuthRef = ctx.getServiceClientOptions('asset-manager').authRef;
    });
    client.eventProcessor('ep', { setup: setupFn as never, processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
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
    client.eventProcessor('ep', { setup: setupFn, processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    const result = await client.runSetupOnTrigger('a');

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['ep: boom']);
  });

  it('registers event processor on start()', async () => {
    const client = makeTestClient({});
    client.eventProcessor('my-ep', { processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });

    await client.start();

    expect(client.registerEventProcessor).toHaveBeenCalledWith('my-ep', expect.anything());
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
    client.eventProcessor('ep', { processBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
    await client.start();
    client.stop();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('injects correct ctx into processBatch callback', async () => {
    const client = makeTestClient({ key: 'value' });
    let capturedCtx: Record<string, unknown> | undefined;
    client.eventProcessor('ep', {
      processBatch: async (ctx, _events) => { capturedCtx = ctx as never; },
    });

    await client.start();

    const registeredProcessor = ((client.registerEventProcessor as jest.Mock).mock.calls[0]! as unknown[])[1] as { eventProcessorBatch: (...args: unknown[]) => Promise<unknown> };
    const batchResult = {};
    const reqSignal = new AbortController().signal;
    await registeredProcessor.eventProcessorBatch({ requestId: 'req-abc', signal: reqSignal }, batchResult, { events: [] });

    expect(capturedCtx!['requestId']).toBe('req-abc');
    expect(capturedCtx!['config']).toEqual({ key: 'value' });
    expect(capturedCtx!['handlerName']).toBe('ep');
    // The context must carry the per-request signal (deadline/cancellation),
    // not a start-level signal that is never aborted.
    expect(capturedCtx!['signal']).toBe(reqSignal);
  });
});

// ---------------------------------------------------------------------------
// REGISTER_PROVIDER capabilities declaration
//
// The runtime declares per-provider flags in REGISTER_PROVIDER. hasSetupHooks
// must reflect the customer's actual handler registrations at the moment of
// connect — not a coarse per-SDK flag. Two providers on the same SDK version,
// one with setup() and one without, must report different values.
// ---------------------------------------------------------------------------

describe('REGISTER_PROVIDER capabilities', () => {
  function grabRuntime(client: WorkflowEngineClient): { setProviderCapabilities: jest.Mock } {
    // The runtime is private; reach into it and spy on the setter.
    const runtime = (client as unknown as { runtime: { setProviderCapabilities: (c: unknown) => void } }).runtime;
    const spy = jest.spyOn(runtime, 'setProviderCapabilities') as unknown as jest.Mock;
    return { setProviderCapabilities: spy };
  }

  it('declares hasSetupHooks=true when any registered handler defines setup', async () => {
    const client = makeTestClient({});
    const runtime = grabRuntime(client);
    client.eventProcessor('with-setup', {
      setup: async () => {},
      processBatch: async () => {},
    });
    await client.start();
    expect(runtime.setProviderCapabilities).toHaveBeenCalledWith({ hasSetupHooks: true });
  });

  it('declares hasSetupHooks=false when no handler defines setup', async () => {
    const client = makeTestClient({});
    const runtime = grabRuntime(client);
    client.eventProcessor('no-setup', {
      processBatch: async () => {},
    });
    await client.start();
    expect(runtime.setProviderCapabilities).toHaveBeenCalledWith({ hasSetupHooks: false });
  });

  it('declares hasSetupHooks=false when only event sources are registered (no setup concept)', async () => {
    const client = makeTestClient({});
    const runtime = grabRuntime(client);
    const mockSource = {
      name: 'src',
      init: jest.fn(), close: jest.fn(),
      eventSourcePoll: jest.fn(), eventSourceValidateConfig: jest.fn(), eventSourceDelete: jest.fn(),
    } as unknown as EventSource;
    client.eventSource(mockSource);
    await client.start();
    expect(runtime.setProviderCapabilities).toHaveBeenCalledWith({ hasSetupHooks: false });
  });

  it('mixed registration: setup on one processor, none on another → true', async () => {
    const client = makeTestClient({});
    const runtime = grabRuntime(client);
    client.eventProcessor('ep-no-setup', { processBatch: async () => {} });
    client.eventProcessor('ep-with-setup', { setup: async () => {}, processBatch: async () => {} });
    await client.start();
    expect(runtime.setProviderCapabilities).toHaveBeenCalledWith({ hasSetupHooks: true });
  });
});
