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

// Records the replies a real WorkflowEngineClient sends for transaction
// batches, and compares them with the expected messages recorded on 1.0.1.

import { mockLogger } from '../mock-logger';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  ActionConfig,
  EngineAPI,
  EvalResult,
  InvocationMode,
  PatchOpType,
  RequestContext,
  TransactionHandler,
  WorkflowEngineClient,
  WSHandleTransactions,
  WSHandleTransactionsResult,
  createTransactionHandler,
} from '../../src/index';
import { FakeEngine, WireMessage } from './fixtures/fake-engine';
import { expectToMatchExpectedMessages } from './helpers/expected-data-helper';

void mockLogger;

const DEADLINE = '2030-01-01T00:00:00.000Z';

const parallel = (handler: ActionConfig<any>['handler']): ActionConfig<any> => ({ invocationMode: InvocationMode.PARALLEL, handler });

const actions = new Map<string, ActionConfig<any>>([
  ['complete', parallel(async (_t, input) => ({ result: EvalResult.COMPLETE, output: { echo: input.value ?? null } }))],
  ['complete-no-output', parallel(async () => ({ result: EvalResult.COMPLETE }))],
  ['complete-custom-stage', parallel(async () => ({ result: EvalResult.COMPLETE, output: { ok: true }, customStage: 'custom' }))],
  ['complete-with-extras', parallel(async (t) => ({
    result: EvalResult.COMPLETE,
    output: { ok: true },
    events: [{ idempotencyKey: t.idempotencyKey, topic: 'done', data: { id: t.transactionId } }],
    triggers: [{ topic: 'trigger-a' }, { topic: 'trigger-b', ephemeral: true }],
    extraUpdates: [{ op: PatchOpType.ADD, path: '/extra', value: 1 }],
  }))],
  ['complete-empty-lists', parallel(async () => ({ result: EvalResult.COMPLETE, output: {}, events: [], triggers: [], extraUpdates: [] }))],
  ['complete-with-deadline', parallel(async () => ({ result: EvalResult.COMPLETE, output: { ok: true }, deadline: DEADLINE }))],
  ['waiting', parallel(async () => ({ result: EvalResult.WAITING }))],
  ['waiting-with-output', parallel(async () => ({ result: EvalResult.WAITING, output: { progress: 50 } }))],
  ['waiting-deadline', parallel(async () => ({ result: EvalResult.WAITING, deadline: DEADLINE }))],
  ['hard-failure', parallel(async () => ({ result: EvalResult.HARD_FAILURE, error: new Error('it broke') }))],
  ['hard-failure-error-data', parallel(async () => ({ result: EvalResult.HARD_FAILURE, error: new Error('it broke'), errorData: { code: 42 } } as any))],
  ['hard-failure-custom-stage', parallel(async () => ({ result: EvalResult.HARD_FAILURE, error: new Error('it broke'), customStage: 'broken' }))],
  ['hard-failure-no-error', parallel(async () => ({ result: EvalResult.HARD_FAILURE }))],
  ['hard-failure-with-output', parallel(async () => ({ result: EvalResult.HARD_FAILURE, output: { partial: true }, error: new Error('it broke') }))],
  ['fixable-error', parallel(async () => ({ result: EvalResult.FIXABLE_ERROR, error: new Error('fix me') }))],
  ['fixable-error-no-error', parallel(async () => ({ result: EvalResult.FIXABLE_ERROR }))],
  ['transient-error', parallel(async () => ({ result: EvalResult.TRANSIENT_ERROR, error: new Error('try again') }))],
  ['throws', parallel(async () => { throw new Error('thrown'); })],
  ['throws-string', parallel(async () => { throw 'a string'; })],
  ['echo-context', parallel(async (t, input) => ({
    result: EvalResult.COMPLETE,
    output: {
      authRef: t.authRef ?? null,
      transactionId: t.transactionId,
      stage: t.stage,
      configProfile: t.configProfile ?? null,
      inputKeys: Object.keys(input).sort(),
      stageDirector: input.stageDirector,
    },
  }))],
  ['batch', {
    invocationMode: InvocationMode.BATCH,
    batchHandler: async (txns) => txns.map(({ transaction, value }) => value.fail
      ? { result: EvalResult.HARD_FAILURE, error: new Error(`failed ${transaction.transactionId}`), errorData: { id: transaction.transactionId } }
      : { result: EvalResult.COMPLETE, output: { id: transaction.transactionId, authRef: transaction.authRef ?? null, batchSize: txns.length } }),
  }],
  ['batch-count-mismatch', { invocationMode: InvocationMode.BATCH, batchHandler: async () => [] }],
  ['batch-throws', { invocationMode: InvocationMode.BATCH, batchHandler: async () => { throw new Error('batch thrown'); } }],
  ['parallel-no-handler', { invocationMode: InvocationMode.PARALLEL }],
]);

const directed = (action: string, overrides: Record<string, unknown> = {}) => ({
  action,
  outputPath: '/output',
  nextStage: 'next',
  failureStage: 'failed',
  ...overrides,
});

const without = (input: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(input).filter(([k]) => !keys.includes(k)));

let seq = 0;
const txn = (input: unknown, extra: Record<string, unknown> = {}) => {
  seq++;
  return {
    handler: 'outcomes',
    workflowId: 'wf-1',
    transactionId: `txn-${seq}`,
    sequence: String(seq),
    idempotencyKey: `idem-${seq}`,
    stage: 'stage-1',
    authRef: `auth-${seq}`,
    input,
    ...extra,
  };
};

const batchOf = (id: string, transactions: unknown[], handler = 'outcomes', extra: Record<string, unknown> = {}) => ({
  messageType: 'handle_transactions',
  id,
  handler,
  transactions,
  ...extra,
});

// Each scenario is one batch. The recording keeps what was sent alongside the reply.
const scenarios: { name: string; batch: WireMessage }[] = [
  ...[...actions.keys()].filter((a) => !a.startsWith('batch')).map((action) => ({
    name: action,
    batch: batchOf(`batch-${action}`, [txn(directed(action, { value: action }))]),
  })),
  { name: 'complete-to-subflow', batch: batchOf('b-subflow', [txn(directed('complete', { nextStage: undefined, nextSubflow: 'sub-1' }))]) },
  { name: 'complete-stage-and-subflow', batch: batchOf('b-both', [txn(directed('complete', { nextSubflow: 'sub-1' }))]) },
  { name: 'complete-custom-stage-over-subflow', batch: batchOf('b-custom-subflow', [txn(directed('complete-custom-stage', { nextStage: undefined, nextSubflow: 'sub-1' }))]) },
  { name: 'complete-no-next-stage', batch: batchOf('b-no-next', [txn(without(directed('complete'), 'nextStage'))]) },
  { name: 'complete-no-output-path', batch: batchOf('b-no-output-path', [txn(without(directed('complete'), 'outputPath'))]) },
  { name: 'hard-failure-no-failure-stage', batch: batchOf('b-no-failure-stage', [txn(without(directed('hard-failure'), 'failureStage'))]) },
  { name: 'hard-failure-no-failure-stage-custom-stage', batch: batchOf('b-no-failure-custom', [txn(without(directed('hard-failure-custom-stage'), 'failureStage'))]) },
  { name: 'null-input', batch: batchOf('b-null-input', [txn(null)]) },
  { name: 'missing-action', batch: batchOf('b-missing-action', [txn({ name: 'x' })]) },
  { name: 'unknown-action', batch: batchOf('b-unknown-action', [txn(directed('nope'))]) },
  {
    name: 'prebuilt-stage-director',
    batch: batchOf('b-prebuilt', [txn({ value: 1, stageDirector: { action: 'echo-context', outputPath: '/out', nextStage: 'n2', failureStage: 'f2' } })]),
  },
  { name: 'config-profile', batch: batchOf('b-profile', [txn(directed('echo-context'), { configProfile: { region: 'eu' } })]) },
  { name: 'no-auth-ref', batch: batchOf('b-no-auth', [txn(directed('echo-context'), { authRef: undefined })]) },
  {
    name: 'batch-mode',
    batch: batchOf('b-batch', [txn(directed('batch')), txn(directed('batch', { fail: true })), txn(directed('batch'))]),
  },
  { name: 'batch-count-mismatch', batch: batchOf('b-batch-mismatch', [txn(directed('batch-count-mismatch')), txn(directed('batch-count-mismatch'))]) },
  { name: 'batch-throws', batch: batchOf('b-batch-throws', [txn(directed('batch-throws')), txn(directed('batch-throws'))]) },
  {
    name: 'mixed-batch',
    batch: batchOf('b-mixed', [
      txn(directed('complete', { value: 'a' })),
      txn(directed('hard-failure')),
      txn(directed('echo-context')),
      txn(directed('nope')),
      txn(directed('batch')),
      txn(directed('throws')),
      txn(directed('batch', { fail: true })),
      txn(directed('echo-context'), { authRef: 'shared-auth' }),
      txn(directed('echo-context'), { authRef: 'shared-auth' }),
      txn(null),
      txn(directed('waiting-deadline')),
    ]),
  },
  { name: 'empty-batch', batch: batchOf('b-empty', []) },
  { name: 'unknown-handler', batch: batchOf('b-unknown-handler', [txn(directed('complete'))], 'not-registered') },
  { name: 'batch-handler-missing', batch: batchOf('b-no-batch-handler', [txn(directed('x')), txn(directed('x'))], 'no-batch-handler') },
];

// A transaction handler written against the raw interface, which calls back
// into the engine API with the request context it was given.
class SubmittingHandler implements TransactionHandler {
  readonly name = 'submitter';
  private engine?: EngineAPI;
  seen: Record<string, unknown>[] = [];
  async init(engAPI: EngineAPI): Promise<void> { this.engine = engAPI; }
  close(): void {}
  async transactionHandlerBatch(reqContext: RequestContext, result: WSHandleTransactionsResult, batch: WSHandleTransactions): Promise<void> {
    this.seen.push({ requestId: reqContext.requestId, authRef: reqContext.authRef ?? null, authTokens: reqContext.authTokens ?? null, aborted: reqContext.signal.aborted });
    result.results = [];
    for (const t of batch.transactions) {
      const submissions = await this.engine!.submitAsyncTransactions(reqContext, t.authRef ?? '', [
        { workflow: 'follow-on', operation: 'start', input: { from: t.transactionId }, idempotencyKey: `follow-${t.transactionId}` },
      ]);
      result.results.push({ stage: 'submitted', stateUpdates: [{ op: PatchOpType.ADD, path: '/submissions', value: submissions }] });
    }
  }
}

async function connect(client: WorkflowEngineClient, engine: FakeEngine, handlers: number, viaStart = false): Promise<void> {
  await (viaStart ? client.start() : client.connect());
  await engine.waitForRegistration(handlers);
}

describe('backwards compatibility: transaction handler wire replies', () => {
  const engine = new FakeEngine();
  let client: WorkflowEngineClient;
  const submitter = new SubmittingHandler();

  beforeAll(async () => {
    await engine.start();
    client = new WorkflowEngineClient({ providerName: 'compat-provider', url: engine.url, maxAttempts: 1 });
    client.registerTransactionHandler('outcomes', createTransactionHandler('outcomes', actions));
    client.registerTransactionHandler('no-batch-handler', createTransactionHandler('no-batch-handler', new Map([['x', { invocationMode: InvocationMode.BATCH }]])));
    client.registerTransactionHandler('submitter', submitter);
    await connect(client, engine, 3);
  });

  afterAll(async () => {
    client.stop();
    await engine.close();
  });

  it('matches the recorded replies for every outcome', async () => {
    const recording = [];
    for (const { name, batch } of scenarios) {
      const reply = await engine.request(batch);
      recording.push({
        scenario: name,
        sent: (batch.transactions as WireMessage[]).map(({ authRef, input, configProfile }) => ({ authRef, input, configProfile })),
        reply,
      });
    }
    expectToMatchExpectedMessages('transactions', recording);
  });

  it('matches the recorded engine API round trip from a raw handler', async () => {
    const batch = batchOf('b-submit', [txn({}, { handler: 'submitter' }), txn({}, { handler: 'submitter' })], 'submitter', {
      authTokens: { 'workflow-engine': 'token-1' },
    });
    const reply = await engine.request(batch);
    expectToMatchExpectedMessages('transactions-engine-api', {
      requestContextSeen: submitter.seen,
      engineApiRequests: engine.ofType('engineapi_submit_transactions'),
      reply,
    });
  });

  it('gives the same replies through the builder registration', async () => {
    const builderEngine = new FakeEngine();
    await builderEngine.start();
    const builderClient = new WorkflowEngineClient({ providerName: 'compat-provider', url: builderEngine.url, maxAttempts: 1 })
      .transactionHandler('outcomes', { handler: createTransactionHandler('outcomes', actions) });
    try {
      await connect(builderClient, builderEngine, 1, true);
      const mixed = scenarios.find((s) => s.name === 'mixed-batch')!.batch;
      const viaBuilder = await builderEngine.request(mixed);
      const viaLowLevel = await engine.request(mixed);
      expect(viaBuilder).toEqual(viaLowLevel);
    } finally {
      builderClient.stop();
      await builderEngine.close();
    }
  });
});
