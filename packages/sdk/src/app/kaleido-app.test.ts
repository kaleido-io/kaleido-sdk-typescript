import { describe, it, expect, vi } from 'vitest';
import { KaleidoApp } from './kaleido-app.js';
import { createSetupContext, createIndexerContext } from './context.js';
import type { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type BindingMap = Record<string, { type: string; bindingType: 'non-hosted'; url: string; auth: Record<string, unknown> }>;

function makeMockWfeClient(bindings: BindingMap = {}) {
  return {
    getServiceBindings: vi.fn().mockReturnValue(bindings),
    getServiceClientOptions: vi.fn((name: string) => {
      if (!bindings[name]) throw new Error(`Binding '${name}' not found`);
      const b = bindings[name];
      return { transport: 'http', url: b.url, auth: b.auth };
    }),
    registerEventProcessor: vi.fn(),
    registerTransactionHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowEngineClient;
}

const singleAMBindings: BindingMap = {
  'asset-manager': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am', auth: {} },
};

// ---------------------------------------------------------------------------
// createSetupContext — assetManagerClient convention
// ---------------------------------------------------------------------------

describe('createSetupContext', () => {
  it('surfaces config, providerName, handlerName', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const ctx = createSetupContext(wfe, { foo: 1 }, 'my-provider', 'my-handler', new AbortController().signal);
    expect(ctx.config).toEqual({ foo: 1 });
    expect(ctx.providerName).toBe('my-provider');
    expect(ctx.handlerName).toBe('my-handler');
  });

  it('assetManagerClient() returns AssetManagerClient for a single binding', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const ctx = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    expect(ctx.assetManagerClient()).toBeInstanceOf(AssetManagerClient);
  });

  it('assetManagerClient() throws when no AM bindings exist', () => {
    const wfe = makeMockWfeClient({});
    const ctx = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    expect(() => ctx.assetManagerClient()).toThrow('No asset-manager service bindings found');
  });

  it('assetManagerClient() throws when multiple AM bindings exist and no name is given', () => {
    const wfe = makeMockWfeClient({
      'am-1': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am1', auth: {} },
      'am-2': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am2', auth: {} },
    });
    const ctx = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    expect(() => ctx.assetManagerClient()).toThrow('Multiple asset-manager service bindings');
  });

  it('assetManagerClient(name) resolves correctly when multiple AM bindings exist', () => {
    const wfe = makeMockWfeClient({
      'am-1': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am1', auth: {} },
      'am-2': { type: 'asset-manager', bindingType: 'non-hosted', url: 'http://am2', auth: {} },
    });
    const ctx = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    expect(ctx.assetManagerClient('am-1')).toBeInstanceOf(AssetManagerClient);
    expect(ctx.assetManagerClient('am-2')).toBeInstanceOf(AssetManagerClient);
    // Different names → different instances
    expect(ctx.assetManagerClient('am-1')).not.toBe(ctx.assetManagerClient('am-2'));
  });

  it('assetManagerClient() caches the instance per binding name', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const ctx = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    expect(ctx.assetManagerClient()).toBe(ctx.assetManagerClient());
  });
});

// ---------------------------------------------------------------------------
// createIndexerContext
// ---------------------------------------------------------------------------

describe('createIndexerContext', () => {
  it('exposes requestId and am shorthand', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const setup = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    const ctx = createIndexerContext(setup, 'req-123');
    expect(ctx.requestId).toBe('req-123');
    expect(ctx.am).toBeInstanceOf(AssetManagerClient);
  });

  it('am getter is stable (same instance on repeated access)', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const setup = createSetupContext(wfe, {}, 'p', 'h', new AbortController().signal);
    const ctx = createIndexerContext(setup, 'req-1');
    expect(ctx.am).toBe(ctx.am);
  });
});

// ---------------------------------------------------------------------------
// KaleidoApp builder
// ---------------------------------------------------------------------------

describe('KaleidoApp builder', () => {
  it('throws on duplicate handler name', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const app = KaleidoApp._createForTest(wfe, {});
    const noop = { process: vi.fn().mockResolvedValue({ events: [] }) };
    app.indexer('my-handler', noop);
    expect(() => app.indexer('my-handler', noop)).toThrow("Handler 'my-handler' is already registered");
  });

  it('throws on duplicate name across handler types', () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const app = KaleidoApp._createForTest(wfe, {});
    app.indexer('shared-name', { process: vi.fn().mockResolvedValue({ events: [] }) });
    expect(() =>
      app.transactionHandler('shared-name', {
        handler: { name: () => 'shared-name', init: vi.fn(), close: vi.fn(), handleTransactions: vi.fn() },
      }),
    ).toThrow("Handler 'shared-name' is already registered");
  });

  it('calls setup hook before connect on start()', async () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const setupFn = vi.fn().mockResolvedValue(undefined);
    const processFn = vi.fn().mockResolvedValue({ events: [] });

    const app = KaleidoApp._createForTest(wfe, {});
    app.indexer('idx', { setup: setupFn, process: processFn });

    await app.start();

    expect(setupFn).toHaveBeenCalledOnce();
    expect(wfe.connect).toHaveBeenCalledOnce();
    // setup called before connect
    const setupOrder = setupFn.mock.invocationCallOrder[0]!;
    const connectOrder = (wfe.connect as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(setupOrder).toBeLessThan(connectOrder);
  });

  it('setup() calls setup hooks but does NOT call connect', async () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const setupFn = vi.fn().mockResolvedValue(undefined);

    const app = KaleidoApp._createForTest(wfe, {});
    app.indexer('idx', { setup: setupFn, process: vi.fn().mockResolvedValue({ events: [] }) });

    await app.setup();

    expect(setupFn).toHaveBeenCalledOnce();
    expect(wfe.connect).not.toHaveBeenCalled();
  });

  it('registers event processor on start()', async () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    const app = KaleidoApp._createForTest(wfe, {});
    app.indexer('my-idx', { process: vi.fn().mockResolvedValue({ events: [] }) });

    await app.start();

    expect(wfe.registerEventProcessor).toHaveBeenCalledWith('my-idx', expect.anything());
  });

  it('injects correct ctx into process callback', async () => {
    const wfe = makeMockWfeClient(singleAMBindings);
    let capturedCtx: unknown;
    const app = KaleidoApp._createForTest(wfe, { key: 'value' });
    app.indexer('idx', {
      process: async (ctx, events) => {
        capturedCtx = ctx;
        return { events };
      },
    });

    await app.start();

    // Invoke the registered processor's batch method
    const registeredProcessor = (wfe.registerEventProcessor as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const batchResult = { events: [] as unknown[] };
    await registeredProcessor.eventProcessorBatch({ requestId: 'req-abc' }, batchResult, { events: [] });

    expect((capturedCtx as any).requestId).toBe('req-abc');
    expect((capturedCtx as any).config).toEqual({ key: 'value' });
    expect((capturedCtx as any).handlerName).toBe('idx');
  });
});
