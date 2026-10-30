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

import { mockLogger } from '../../tests/mock-logger';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createServiceTransport } from '@kaleido-io/core-sdk/http';

import { WorkflowEngineClient, WorkflowEngineClientConfig } from '../client/client';
import { createTransactionHandler } from '../factories/transaction_handler';
import { createEventSource } from '../factories/event_source';
import { evalDirected } from '../helpers/stage_director';
import { ActionConfig } from '../interfaces/handlers';
import { EvalResult, InvocationMode, WSHandleTransactionsResult, WSMessageType } from '../types/core';
import type { EventSourceContext, TransactionContext } from './context';
import { FakeEngine, WireMessage } from '../../tests/backwards-compatibility/fixtures/fake-engine';

void mockLogger;

const bindings: WorkflowEngineClientConfig['serviceBindings'] = {
  hosted: { bindingType: 'hosted', serviceType: 'AssetManagerService', id: 's-am' },
  direct: { bindingType: 'non-hosted', url: 'http://direct.invalid', auth: { type: 'token', token: 't' } },
};

const directed = (action: string, extra: Record<string, unknown> = {}) => ({
  action, outputPath: '/output', nextStage: 'next', failureStage: 'failed', ...extra,
});

const txn = (id: string, input: unknown, authRef?: string) => ({
  handler: 'ctx', workflowId: 'wf', transactionId: id, sequence: '1', stage: 's', authRef, input,
});

const batch = (id: string, transactions: unknown[], extra: Record<string, unknown> = {}) => ({
  messageType: 'handle_transactions', id, handler: 'ctx', transactions, ...extra,
});

const outputs = (reply: WireMessage) => reply.results.map((r: WireMessage) => r.error ?? r.stateUpdates?.[0]?.value);

// Actions that report what their context held.
function actions(seen: TransactionContext[]): Map<string, ActionConfig<any>> {
  return new Map<string, ActionConfig<any>>([
    ['describe', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction, _input, ctx) => {
        seen.push(ctx!);
        return {
          result: EvalResult.COMPLETE,
          output: {
            sameTransaction: ctx!.transaction === transaction,
            transactionId: ctx!.transaction.transactionId,
            requestId: ctx!.requestId,
            handlerName: ctx!.handlerName,
            providerName: ctx!.providerName,
            config: ctx!.config,
            aborted: ctx!.signal.aborted,
          },
        };
      },
    }],
    ['call-hosted', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (_t, input, ctx) => ({
        result: EvalResult.COMPLETE,
        output: await createServiceTransport(ctx!.getServiceClientOptions('hosted')).get(`/api/v1/${input.path}`),
      }),
    }],
    ['options', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (_t, input, ctx) => {
        const { wsProxy, ...options } = ctx!.getServiceClientOptions(input.binding) as unknown as Record<string, unknown>;
        return { result: EvalResult.COMPLETE, output: { ...options, hasProxy: wsProxy !== undefined } };
      },
    }],
    ['wait-for-abort', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (_t, _input, ctx) => {
        await new Promise((resolve) => ctx!.signal.addEventListener('abort', resolve));
        return { result: EvalResult.COMPLETE, output: { aborted: ctx!.signal.aborted, reason: String(ctx!.signal.reason) } };
      },
    }],
    ['batch', {
      invocationMode: InvocationMode.BATCH,
      batchHandler: async (txns) => txns.map(({ transaction, ctx }) => ({
        result: EvalResult.COMPLETE,
        output: { transactionId: transaction.transactionId, ctxTransactionId: ctx!.transaction.transactionId, authRef: (ctx!.getServiceClientOptions('hosted') as { authRef?: string }).authRef ?? null },
      })),
    }],
  ]);
}

describe('per-request context', () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function connected(register: (client: WorkflowEngineClient<{ app: string }>, seen: TransactionContext[]) => void, viaStart: boolean, handlers = 1) {
    const engine = new FakeEngine({
      onServiceProxyRequest: (msg) => ({ status: 200, body: { path: msg.request.path, authRef: msg.authRef ?? null } }),
    });
    await engine.start();
    cleanup.push(() => engine.close());
    const client = new WorkflowEngineClient<{ app: string }>({ providerName: 'ctx-provider', url: engine.url, maxAttempts: 1, serviceBindings: bindings }, { app: 'config' });
    cleanup.push(() => client.stop());
    const seen: TransactionContext[] = [];
    register(client, seen);
    await (viaStart ? client.start() : client.connect());
    await engine.waitForRegistration(handlers);
    return { engine, seen };
  }

  const lowLevel = (client: WorkflowEngineClient<any>, seen: TransactionContext[]) =>
    client.registerTransactionHandler('ctx', createTransactionHandler('ctx', actions(seen)));
  const builder = (client: WorkflowEngineClient<any>, seen: TransactionContext[]) => {
    client.transactionHandler('ctx', { handler: createTransactionHandler('ctx', actions(seen)) });
  };

  it.each([
    ['the low-level registration', lowLevel, false],
    ['the builder registration', builder, true],
  ])('is passed to each action through %s', async (_name, register, viaStart) => {
    const { engine } = await connected(register, viaStart);
    const reply = await engine.request(batch('b1', [txn('t1', directed('describe'), 'a1'), txn('t2', directed('describe'), 'a2')]));
    expect(outputs(reply)).toEqual([
      { sameTransaction: true, transactionId: 't1', requestId: 'b1', handlerName: 'ctx', providerName: 'ctx-provider', config: { app: 'config' }, aborted: false },
      { sameTransaction: true, transactionId: 't2', requestId: 'b1', handlerName: 'ctx', providerName: 'ctx-provider', config: { app: 'config' }, aborted: false },
    ]);
  });

  it('resolves hosted bindings as each transaction\'s own caller', async () => {
    const { engine } = await connected(lowLevel, false);
    const reply = await engine.request(batch('b2', [
      txn('t1', directed('call-hosted', { path: 'one' }), 'auth-1'),
      txn('t2', directed('call-hosted', { path: 'two' }), 'auth-2'),
      txn('t3', directed('call-hosted', { path: 'three' })),
    ]));
    expect(outputs(reply)).toEqual([
      { path: '/api/v1/one', authRef: 'auth-1' },
      { path: '/api/v1/two', authRef: 'auth-2' },
      { path: '/api/v1/three', authRef: null },
    ]);
    expect(engine.ofType('service-proxy-request').map((m) => [m.serviceType, m.id, m.authRef ?? null])).toEqual([
      ['AssetManagerService', 's-am', 'auth-1'],
      ['AssetManagerService', 's-am', 'auth-2'],
      ['AssetManagerService', 's-am', null],
    ]);
  });

  it('gives proxy options for hosted bindings, HTTP options otherwise, and a clear error for unknown ones', async () => {
    const { engine } = await connected(lowLevel, false);
    const reply = await engine.request(batch('b3', [
      txn('t1', directed('options', { binding: 'hosted' }), 'auth-1'),
      txn('t2', directed('options', { binding: 'direct' }), 'auth-2'),
      txn('t3', directed('options', { binding: 'missing' }), 'auth-3'),
    ]));
    expect(outputs(reply)).toEqual([
      { transport: 'ws-proxy', serviceType: 'AssetManagerService', id: 's-am', authRef: 'auth-1', hasProxy: true },
      { transport: 'http', url: 'http://direct.invalid', auth: { type: 'token', token: 't' }, hasProxy: false },
      "Service binding 'missing' not found. Available bindings: hosted, direct",
    ]);
  });

  it('aborts the signal when the request deadline passes, and once the reply is sent', async () => {
    const { engine, seen } = await connected(lowLevel, false);
    const reply = await engine.request(batch('b4', [txn('t1', directed('wait-for-abort'), 'a1')], { deadline: new Date(Date.now() + 50).toISOString() }));
    expect(outputs(reply)[0]).toEqual({ aborted: true, reason: expect.stringContaining('deadline exceeded') });

    await engine.request(batch('b5', [txn('t2', directed('describe'), 'a2')]));
    expect(seen[0].signal.aborted).toBe(true);
  });

  it('gives each transaction in a batch handler its own context', async () => {
    const { engine } = await connected(lowLevel, false);
    const reply = await engine.request(batch('b6', [txn('t1', directed('batch'), 'auth-1'), txn('t2', directed('batch'), 'auth-2')]));
    expect(outputs(reply)).toEqual([
      { transactionId: 't1', ctxTransactionId: 't1', authRef: 'auth-1' },
      { transactionId: 't2', ctxTransactionId: 't2', authRef: 'auth-2' },
    ]);
  });

  it('is still passed when evalDirected runs without a client, and says why bindings fail', async () => {
    const seen: TransactionContext[] = [];
    const reply: WSHandleTransactionsResult = { messageType: WSMessageType.HANDLE_TRANSACTIONS_RESULT, id: 'b7', results: [] };
    await evalDirected(reply, {
      messageType: WSMessageType.HANDLE_TRANSACTIONS,
      id: 'b7',
      handler: 'ctx',
      transactions: [txn('t1', directed('describe'), 'a1'), txn('t2', directed('options', { binding: 'hosted' }), 'a2')],
    }, actions(seen));
    expect(seen[0].transaction.transactionId).toBe('t1');
    expect(seen[0].signal.aborted).toBe(false);
    expect(reply.results[1]).toEqual({
      error: "KA140642: Service binding 'hosted' can't be resolved: the handler isn't running in a WorkflowEngineClient",
    });
  });
});

describe('per-poll event source context', () => {
  let engine: FakeEngine;
  let client: WorkflowEngineClient<{ app: string }>;

  afterEach(async () => {
    client?.stop();
    await engine?.close();
  });

  it('carries the stream, provider config and a binding lookup tied to the poll\'s authRef', async () => {
    engine = new FakeEngine({ onServiceProxyRequest: (msg) => ({ status: 200, body: { authRef: msg.authRef ?? null } }) });
    await engine.start();
    const seen: EventSourceContext[] = [];
    const source = createEventSource<{ n: number }, unknown, unknown>('ctx-source', async (conf, checkpoint, authRef, ctx) => {
      seen.push(ctx!);
      const called = await createServiceTransport(ctx!.getServiceClientOptions('hosted')).get('/api/v1/check');
      return { checkpointOut: { n: (checkpoint?.n ?? 0) + 1 }, events: [{ idempotencyKey: `${conf.streamId}-${authRef}`, topic: 't', data: called }] };
    });
    client = new WorkflowEngineClient<{ app: string }>({ providerName: 'ctx-provider', url: engine.url, maxAttempts: 1, serviceBindings: bindings }, { app: 'config' });
    client.registerEventSource('ctx-source', source);
    await client.connect();
    await engine.waitForRegistration(1);

    engine.send({ messageType: 'event_source_config', id: 'c1', handler: 'ctx-source', streamId: 's1', streamName: 'stream-one', config: { stream: 'config' } });
    const reply = await engine.request({ messageType: 'event_source_poll', id: 'p1', handler: 'ctx-source', streamId: 's1', streamName: 'stream-one', authRef: 'owner-auth' });

    expect(reply.events).toEqual([{ idempotencyKey: 's1-owner-auth', topic: 't', data: { authRef: 'owner-auth' } }]);
    expect(seen[0]).toMatchObject({
      requestId: 'p1',
      stream: { streamId: 's1', streamName: 'stream-one' },
      config: { app: 'config' },
      providerName: 'ctx-provider',
      handlerName: 'ctx-source',
    });
    expect(seen[0].signal.aborted).toBe(true);
  });
});
