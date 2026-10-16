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

/**
 * Helpers for unit-testing handlers, imported from
 * `@kaleido-io/workflow-engine-sdk/testing`.
 */

import type { ServiceClientOptions } from '@kaleido-io/core-sdk/http';
import type { TransactionContext } from '../app/context';
import type { ActionMap, TransactionAction, UntypedActionMap } from '../handlers/define';
import type { ActionConfig, TransactionHandlerFn } from '../interfaces/handlers';
import type { StageDirector, WithStageDirector, WSEvaluateTransaction } from '../types/core';

export type ActionResult = Awaited<ReturnType<TransactionHandlerFn<WithStageDirector>>>;

export interface InvokeActionOptions<CustomConfig = unknown> {
  /** Fields of the transaction the action sees, for example `authRef` or `state`. */
  transaction?: Partial<WSEvaluateTransaction>;
  /** The provider config the action sees as `ctx.config`. */
  config?: CustomConfig;
  /** Options returned by `ctx.getServiceClientOptions(name)`, by binding name. */
  bindings?: Record<string, ServiceClientOptions>;
  /** The stage's directing fields. Defaults to `outputPath: '/output'`, `nextStage: 'next'`, `failureStage: 'failed'`. */
  stageDirector?: Partial<StageDirector>;
  /** Overrides for any other part of the context, for example `signal`. */
  ctx?: Partial<TransactionContext<CustomConfig>>;
}

function contextFor(action: string, transaction: WSEvaluateTransaction, options: InvokeActionOptions<unknown>): TransactionContext {
  return {
    config: options.config ?? {},
    providerName: 'test-provider',
    handlerName: 'test-handler',
    signal: new AbortController().signal,
    requestId: 'test-request',
    transaction,
    getServiceClientOptions: (name: string) => {
      const binding = options.bindings?.[name];
      if (!binding) {
        throw new Error(`invokeAction: no binding '${name}' given for action '${action}' (pass it in options.bindings)`);
      }
      return binding;
    },
    ...options.ctx,
  };
}

/**
 * Run one action of an action map the way the engine does, and return its
 * result: `result` (an `EvalResult`), `output`, `error`, `customStage` and so on.
 * Pass only the action's own input; the directing fields are filled in.
 *
 * @example
 * const result = await invokeAction(actionMap, 'hello', { name: 'World' });
 * expect(result.result).toBe(EvalResult.COMPLETE);
 * expect(result.output).toEqual({ greeting: 'Hello World!' });
 */
export async function invokeAction<A extends Record<string, TransactionAction>, K extends keyof A & string>(
  actionMap: ActionMap<A>,
  action: K,
  input?: Omit<Parameters<A[K]>[0], keyof StageDirector | 'stageDirector'>,
  options?: InvokeActionOptions,
): Promise<ActionResult>;
export async function invokeAction(
  actionMap: UntypedActionMap,
  action: string,
  input?: Record<string, unknown>,
  options?: InvokeActionOptions,
): Promise<ActionResult>;
export async function invokeAction(
  actionMap: Map<string, ActionConfig<any>>,
  action: string,
  input: Record<string, unknown> = {},
  options: InvokeActionOptions = {},
): Promise<ActionResult> {
  const config = actionMap.get(action);
  if (!config?.handler) {
    throw new Error(`invokeAction: no action '${action}' (actions: ${[...actionMap.keys()].join(', ') || 'none'})`);
  }
  const stageDirector: StageDirector = { action, outputPath: '/output', nextStage: 'next', failureStage: 'failed', ...options.stageDirector };
  const transaction = {
    handler: 'test-handler',
    workflowId: 'test-workflow',
    transactionId: 'test-transaction',
    sequence: '1',
    stage: 'test-stage',
    ...options.transaction,
  } as WSEvaluateTransaction;
  const stageInput = { ...stageDirector, ...input, stageDirector };
  return config.handler(transaction, stageInput, contextFor(action, transaction, options));
}
