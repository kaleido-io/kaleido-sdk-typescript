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
import { describe, expect, it } from '@jest/globals';

import { evalDirected } from '../helpers/stage_director';
import { EvalResult, InvocationMode, WSEvaluateReplyResult, WSHandleTransactionsResult, WSMessageType } from '../types/core';
import type { ActionConfig } from '../interfaces/handlers';
import type { EventProcessorContext, TransactionContext } from '../app/context';
import { invokeAction } from '../testing';
import { RetryableError, StageError, complete, defineProcessor, defineTransactionHandler, waiting } from './define';

void mockLogger;

// What the engine receives for one transaction, through the real reply mapping.
async function reply(actionMap: Map<string, ActionConfig<any>>, action: string, fields: Record<string, unknown> = {}, directing: Record<string, unknown> = {}): Promise<WSEvaluateReplyResult> {
  const result: WSHandleTransactionsResult = { messageType: WSMessageType.HANDLE_TRANSACTIONS_RESULT, id: 'b', results: [] };
  await evalDirected(result, {
    messageType: WSMessageType.HANDLE_TRANSACTIONS,
    id: 'b',
    handler: 'h',
    transactions: [{
      handler: 'h', workflowId: 'w', transactionId: 't1', sequence: '1', stage: 's', authRef: 'auth-1',
      input: { action, outputPath: '/output', nextStage: 'next', failureStage: 'failed', ...directing, ...fields },
    }],
  }, actionMap);
  return result.results[0];
}

const actions = defineTransactionHandler({
  greet: async (input: { name: string }) => ({ greeting: `Hello ${input.name}!` }),
  sync: (input: { n: number }) => ({ doubled: input.n * 2 }),
  nothing: () => undefined,
  vip: async (input: { name: string }) => complete({ greeting: `Welcome ${input.name}` }, { stage: 'vip-lounge' }),
  announce: async () => complete({ ok: true }, { events: [{ idempotencyKey: 'k1', topic: 'announced', data: { n: 1 } }] }),
  'complete-empty': () => complete(),
  wait: () => waiting({ deadline: new Date('2030-01-01T00:00:00Z') }),
  'wait-string': () => waiting({ deadline: '2031-01-01T00:00:00.000Z' }),
  'wait-with-output': () => waiting({ output: { submitted: 'tx-1' } }),
  'wait-plain': () => waiting(),
  throws: async () => { throw new Error('plain failure'); },
  'throws-string': () => { throw 'not an Error'; },
  'throws-object': () => { throw { code: 7 }; },
  'stage-error': () => { throw new StageError('rejected', { stage: 'manual-review', data: { reason: 'limit' } }); },
  'stage-error-default-stage': () => { throw new StageError('rejected', { data: { reason: 'limit' } }); },
  retry: () => { throw new RetryableError('service busy'); },
  'looks-like-outcome': () => ({ result: 'complete', stage: 'not-a-stage', events: ['not', 'events'], error: 'not an error', deadline: 'never' }),
  'context': (_input: unknown, ctx: TransactionContext) => ({ transactionId: ctx.transaction.transactionId, authRef: ctx.transaction.authRef, handlerName: ctx.handlerName }),
});

describe('defineTransactionHandler', () => {
  it('completes to nextStage with a returned value as output', async () => {
    expect(await reply(actions, 'greet', { name: 'Ada' })).toEqual({ stage: 'next', stateUpdates: [{ op: 'add', path: '/output', value: { greeting: 'Hello Ada!' } }] });
    expect(await reply(actions, 'sync', { n: 2 })).toEqual({ stage: 'next', stateUpdates: [{ op: 'add', path: '/output', value: { doubled: 4 } }] });
    expect(await reply(actions, 'nothing')).toEqual({ stage: 'next' });
  });

  it('fails to failureStage when the action throws', async () => {
    expect(await reply(actions, 'throws')).toEqual({ stage: 'failed', stateUpdates: [{ op: 'add', path: '/error', value: 'plain failure' }] });
    expect(await reply(actions, 'throws-string')).toEqual({ stage: 'failed', stateUpdates: [{ op: 'add', path: '/error', value: 'not an Error' }] });
    expect(await reply(actions, 'throws-object')).toEqual({ stage: 'failed', stateUpdates: [{ op: 'add', path: '/error', value: '[object Object]' }] });
  });

  it('chooses the next stage and emits events with complete()', async () => {
    expect(await reply(actions, 'vip', { name: 'Ada' })).toEqual({ stage: 'vip-lounge', stateUpdates: [{ op: 'add', path: '/output', value: { greeting: 'Welcome Ada' } }] });
    expect(await reply(actions, 'announce')).toEqual({
      stage: 'next',
      stateUpdates: [{ op: 'add', path: '/output', value: { ok: true } }],
      events: [{ idempotencyKey: 'k1', topic: 'announced', data: { n: 1 } }],
    });
    expect(await reply(actions, 'complete-empty')).toEqual({ stage: 'next' });
  });

  it('stays in the stage with waiting()', async () => {
    expect(await reply(actions, 'wait')).toEqual({ deadline: '2030-01-01T00:00:00.000Z' });
    expect(await reply(actions, 'wait-string')).toEqual({ deadline: '2031-01-01T00:00:00.000Z' });
    expect(await reply(actions, 'wait-with-output')).toEqual({ stateUpdates: [{ op: 'add', path: '/output', value: { submitted: 'tx-1' } }] });
    expect(await reply(actions, 'wait-plain')).toEqual({});
  });

  it('routes a StageError to its stage with its data', async () => {
    expect(await reply(actions, 'stage-error')).toEqual({
      stage: 'manual-review',
      stateUpdates: [{ op: 'add', path: '/error', value: 'rejected' }, { op: 'add', path: '/errorData', value: { reason: 'limit' } }],
    });
    expect(await reply(actions, 'stage-error-default-stage')).toEqual({
      stage: 'failed',
      stateUpdates: [{ op: 'add', path: '/error', value: 'rejected' }, { op: 'add', path: '/errorData', value: { reason: 'limit' } }],
    });
    // A StageError with a stage needs no failureStage on the stage.
    expect(await reply(actions, 'stage-error', {}, { failureStage: undefined })).toMatchObject({ stage: 'manual-review' });
  });

  it('asks the engine to retry for a RetryableError', async () => {
    expect(await reply(actions, 'retry')).toEqual({ error: 'service busy' });
  });

  it('treats an output that looks like an outcome as plain output', async () => {
    expect(await reply(actions, 'looks-like-outcome')).toEqual({
      stage: 'next',
      stateUpdates: [{ op: 'add', path: '/output', value: { result: 'complete', stage: 'not-a-stage', events: ['not', 'events'], error: 'not an error', deadline: 'never' } }],
    });
  });

  it('recognises outcomes and errors made by another copy of the SDK', async () => {
    const kind = Symbol.for('@kaleido-io/workflow-engine-sdk/handler-result');
    const foreign = defineTransactionHandler({
      complete: () => ({ [kind]: 'complete', output: { ok: 1 }, stage: 'elsewhere' }),
      'stage-error': () => { throw Object.assign(new Error('foreign'), { [kind]: 'stage-error', stage: 'review' }); },
    });
    expect(await reply(foreign, 'complete')).toEqual({ stage: 'elsewhere', stateUpdates: [{ op: 'add', path: '/output', value: { ok: 1 } }] });
    expect(await reply(foreign, 'stage-error')).toMatchObject({ stage: 'review' });
  });

  it('passes each transaction\'s context to the action', async () => {
    expect(await reply(actions, 'context')).toEqual({ stage: 'next', stateUpdates: [{ op: 'add', path: '/output', value: { transactionId: 't1', authRef: 'auth-1', handlerName: 'h' } }] });
  });

  it('runs actions in parallel mode and keeps a raw SDK throw a retry', async () => {
    expect([...actions.values()].every((c) => c.invocationMode === InvocationMode.PARALLEL)).toBe(true);
    const raw = new Map<string, ActionConfig<any>>([['raw', { invocationMode: InvocationMode.PARALLEL, handler: async () => { throw new Error('raw'); } }]]);
    expect(await reply(raw, 'raw')).toEqual({ error: 'raw' });
  });

  it('checks action inputs at compile time', () => {
    defineTransactionHandler({
      a: (input: { name: string }) => input.name.toUpperCase(),
      b: (input: { count: number }) => input.count + 1,
      // @ts-expect-error a typo in an input field
      c: (input: { name: string }) => input.nmae,
    });
    expect(true).toBe(true);
  });
});

describe('defineProcessor', () => {
  const ctx = { requestId: 'r1', config: { table: 't' } } as unknown as EventProcessorContext<{ table: string }>;
  const events = [{ idempotencyKey: 'k1', topic: 't', data: { n: 1 } }];

  it('works as a processBatch function and as a definition', async () => {
    const seen: unknown[] = [];
    const processor = defineProcessor(async (batch: typeof events, c: EventProcessorContext<{ table: string }>) => {
      seen.push({ events: batch, table: c.config.table, requestId: c.requestId });
    });
    await processor(ctx, events);
    await processor.processBatch(ctx, events);
    expect(seen).toEqual([{ events, table: 't', requestId: 'r1' }, { events, table: 't', requestId: 'r1' }]);
  });

  it('accepts a function that ignores the context, as the old kit did', async () => {
    let count = 0;
    const processor = defineProcessor((batch) => { count += batch.length; });
    await processor(ctx, events);
    expect(count).toBe(1);
  });

  it('surfaces errors from the function', async () => {
    const processor = defineProcessor(async () => { throw new Error('processor failed'); });
    await expect(processor(ctx, events)).rejects.toThrow('processor failed');
  });
});

describe('invokeAction', () => {
  it('runs an action with only its own input', async () => {
    const result = await invokeAction(actions, 'greet', { name: 'World' });
    expect(result).toMatchObject({ result: EvalResult.COMPLETE, output: { greeting: 'Hello World!' } });
  });

  it('returns outcomes and failures as the SDK result', async () => {
    expect(await invokeAction(actions, 'vip', { name: 'Ada' })).toMatchObject({ result: EvalResult.COMPLETE, customStage: 'vip-lounge' });
    expect(await invokeAction(actions, 'stage-error')).toMatchObject({ result: EvalResult.HARD_FAILURE, customStage: 'manual-review', errorData: { reason: 'limit' } });
    expect(await invokeAction(actions, 'retry')).toMatchObject({ result: EvalResult.TRANSIENT_ERROR, error: expect.objectContaining({ message: 'service busy' }) });
  });

  it('gives the action a context with the transaction, config and bindings it was given', async () => {
    const seen = defineTransactionHandler({
      inspect: (_input: unknown, ctx: TransactionContext<{ region: string }>) => ({
        authRef: ctx.transaction.authRef,
        region: ctx.config.region,
        binding: ctx.getServiceClientOptions('asset-manager'),
        aborted: ctx.signal.aborted,
      }),
      missing: (_input: unknown, ctx: TransactionContext) => ctx.getServiceClientOptions('nope'),
    });
    const binding = { transport: 'http' as const, url: 'http://am.test' };
    expect(await invokeAction(seen, 'inspect', {}, { transaction: { authRef: 'a1' }, config: { region: 'eu' }, bindings: { 'asset-manager': binding } }))
      .toMatchObject({ output: { authRef: 'a1', region: 'eu', binding, aborted: false } });
    expect(await invokeAction(seen, 'missing')).toMatchObject({
      result: EvalResult.HARD_FAILURE,
      error: expect.objectContaining({ message: "invokeAction: no binding 'nope' given for action 'missing' (pass it in options.bindings)" }),
    });
  });

  it('runs actions of a plain SDK map, with the stage directing fields filled in', async () => {
    const plain = new Map<string, ActionConfig<any>>([
      ['echo', { invocationMode: InvocationMode.PARALLEL, handler: async (_t, input) => ({ result: EvalResult.COMPLETE, output: input }) }],
    ]);
    const result = await invokeAction(plain, 'echo', { value: 1 }, { stageDirector: { nextStage: 'after' } });
    expect(result.output).toEqual({
      action: 'echo', outputPath: '/output', nextStage: 'after', failureStage: 'failed', value: 1,
      stageDirector: { action: 'echo', outputPath: '/output', nextStage: 'after', failureStage: 'failed' },
    });
  });

  it('names the actions it has when asked for one it does not', async () => {
    await expect(invokeAction(new Map(), 'nope')).rejects.toThrow("invokeAction: no action 'nope' (actions: none)");
  });

  it('checks action names and inputs at compile time', async () => {
    // @ts-expect-error an action the map does not have
    await expect(invokeAction(actions, 'gret', { name: 'x' })).rejects.toThrow();
    // @ts-expect-error the wrong input type
    await invokeAction(actions, 'greet', { name: 42 });
  });
});
