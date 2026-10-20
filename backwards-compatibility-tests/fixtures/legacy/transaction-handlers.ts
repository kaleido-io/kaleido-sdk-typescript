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

// Transaction handler patterns that custom providers written against 1.0.1 use.
// These are only type-checked, never run.

import {
  ActionConfig,
  BasicStageDirector,
  EngineAPI,
  EvalResult,
  InvocationMode,
  PatchOpType,
  RequestContext,
  StageDirectorHelper,
  TransactionHandler,
  TransactionHandlerBatchFn,
  TransactionHandlerBatchIn,
  TransactionHandlerBatchOut,
  TransactionHandlerFn,
  WithStageDirector,
  WSEvaluateReplyResult,
  WSEvaluateTransaction,
  WSHandleTransactions,
  WSHandleTransactionsResult,
  WSMessageType,
  createTransactionHandler,
  evalDirected,
} from '@kaleido-io/workflow-engine-sdk';

interface GreetInput extends WithStageDirector {
  name: string;
}

// A handler declared with its own explicit function type.
const greet: TransactionHandlerFn<GreetInput> = async (transaction, input) => ({
  result: EvalResult.COMPLETE,
  output: { greeting: `Hello ${input.name}`, by: transaction.transactionId },
  events: [{ idempotencyKey: transaction.idempotencyKey, topic: 'greeted', data: input.name }],
  triggers: [{ topic: `greeted-${input.name}` }],
  extraUpdates: [{ op: PatchOpType.ADD, path: '/greeted', value: true }],
});

// Handlers that take fewer parameters than the SDK passes.
const noArgs: TransactionHandlerFn<GreetInput> = async () => ({ result: EvalResult.WAITING, deadline: new Date().toISOString() });
const oneArg: TransactionHandlerFn<GreetInput> = async (transaction) => ({
  result: transaction.authRef ? EvalResult.COMPLETE : EvalResult.HARD_FAILURE,
  error: new Error('no authRef'),
  customStage: 'unauthorised',
});

const greetBatch: TransactionHandlerBatchFn<GreetInput> = async (transactions) =>
  transactions.map(({ transaction, value }): TransactionHandlerBatchOut => ({
    result: EvalResult.COMPLETE,
    output: { greeting: `Hello ${value.name}`, id: transaction.transactionId },
    errorData: undefined,
  }));

export const actionMap: Map<string, ActionConfig<GreetInput>> = new Map([
  ['greet', { invocationMode: InvocationMode.PARALLEL, handler: greet }],
  ['no-args', { invocationMode: InvocationMode.PARALLEL, handler: noArgs }],
  ['one-arg', { invocationMode: InvocationMode.PARALLEL, handler: oneArg }],
  ['greet-batch', { invocationMode: InvocationMode.BATCH, batchHandler: greetBatch }],
  // Inline handlers with the parameter types written out, as the samples do.
  ['inline', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction: WSEvaluateTransaction, input: GreetInput) => ({
      result: EvalResult.COMPLETE,
      output: { stage: transaction.stage, name: input.name },
    }),
  }],
]);

// A stored EngineAPI reference, used to submit follow-on transactions.
let engine: EngineAPI | undefined;
export const greeter = createTransactionHandler('greeter', actionMap)
  .withInitFn(async (engAPI) => { engine = engAPI; })
  .withCloseFn(() => { engine = undefined; });

export async function submitFollowOn(reqContext: RequestContext, authRef: string): Promise<string[]> {
  const results = await engine!.submitAsyncTransactions(reqContext, authRef, [
    { workflow: 'follow-on', operation: 'start', input: { from: reqContext.requestId }, idempotencyKey: 'k1' },
  ]);
  return results.map((r) => r.id);
}

// A TransactionHandler written from scratch, without the factory.
export class RawTransactionHandler implements TransactionHandler {
  readonly name = 'raw';
  async init(_engAPI: EngineAPI): Promise<void> {}
  close(): void {}
  async transactionHandlerBatch(
    reqContext: RequestContext,
    result: WSHandleTransactionsResult,
    batch: WSHandleTransactions,
  ): Promise<void> {
    reqContext.signal.throwIfAborted();
    result.results = batch.transactions.map((t): WSEvaluateReplyResult => ({
      stage: 'done',
      stateUpdates: [{ op: PatchOpType.ADD, path: '/seen', value: t.authRef ?? reqContext.authRef }],
    }));
  }
}

// A TransactionHandler that delegates to evalDirected itself.
export class DelegatingTransactionHandler implements TransactionHandler {
  readonly name = 'delegating';
  async init(): Promise<void> {}
  close(): void {}
  async transactionHandlerBatch(_reqContext: RequestContext, result: WSHandleTransactionsResult, batch: WSHandleTransactions): Promise<void> {
    await evalDirected(result, batch, actionMap);
  }
}

// What unit tests in custom providers do: build SDK values by hand and call
// handlers directly.
export async function unitTestPatterns(): Promise<void> {
  const controller = new AbortController();
  const reqContext: RequestContext = {
    requestId: 'r1',
    signal: controller.signal,
    cancel: () => controller.abort(),
  };
  const reqContextWithAuth: RequestContext = { ...reqContext, authRef: 'a1', authTokens: { t: 'x' } };

  const transaction = { transactionId: 't1', stage: 's1', authRef: 'a1' } as WSEvaluateTransaction;
  const input: GreetInput = {
    name: 'World',
    stageDirector: new BasicStageDirector('greet', '/output', 'next', 'failed'),
  };

  // Call an action handler with the two arguments 1.0.1 passes.
  const single = await actionMap.get('greet')!.handler!(transaction, input);
  const status: EvalResult = single.result;

  // Build batch inputs by hand and call a batch handler.
  const batchIn: TransactionHandlerBatchIn<GreetInput>[] = [{ transaction, value: input }];
  const batchOut: TransactionHandlerBatchOut[] = await actionMap.get('greet-batch')!.batchHandler!(batchIn);

  // Drive evalDirected with hand-built wire messages.
  const batch: WSHandleTransactions = {
    messageType: WSMessageType.HANDLE_TRANSACTIONS,
    id: 'b1',
    handler: 'greeter',
    transactions: [transaction],
  };
  const reply: WSHandleTransactionsResult = {
    messageType: WSMessageType.HANDLE_TRANSACTIONS_RESULT,
    id: 'b1',
    results: [],
  };
  await evalDirected(reply, batch, actionMap);
  await greeter.transactionHandlerBatch(reqContextWithAuth, reply, batch);

  // Map an outcome directly, with the positional parameters.
  const mapped: WSEvaluateReplyResult = StageDirectorHelper.mapOutput(input.stageDirector, transaction, EvalResult.COMPLETE, { ok: true });
  const mappedAll = StageDirectorHelper.mapOutput(
    input.stageDirector, transaction, EvalResult.HARD_FAILURE, undefined, new Error('x'), { why: 'x' },
    [{ topic: 't' }], [], 'custom', [{ topic: 'e', data: 1 }], undefined,
  );

  void [status, batchOut, mapped, mappedAll, submitFollowOn(reqContext, 'a1')];
}
