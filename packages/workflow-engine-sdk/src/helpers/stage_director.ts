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
 * Stage Director Helper
 * 
 * Provides the StageDirector pattern for building composable transaction handlers.
 * The StageDirector pattern allows handlers to define multiple "actions" that can
 * be configured to transition to different stages based on success or failure.
 */

import { SDKErrors, newError } from '../i18n/errors';
import {
  DirectedActionConfig,
  DirectedTransactionBatchIn
} from '../interfaces/handlers';
import { newLogger } from '../log/logger';
import {
  EvalResult,
  ExecutableTransaction,
  HandlerEvent,
  InvocationMode,
  Patch,
  PatchOpType,
  StageDirector,
  Trigger,
  WSHandleTransactions,
  WSHandleTransactionsResult,
  WSEvaluateReplyResult,
  WSEvaluateTransaction,
  WithStageDirector,
} from '../types/core';
import { getErrorMessage } from '../utils/errors';

const log = newLogger('stage_director.ts');

/**
 * Basic StageDirector implementation
 */
export class BasicStageDirector implements StageDirector, WithStageDirector {
  constructor(
    public action: string,
    public outputPath: string,
    public nextStage: string,
    public failureStage: string
  ) { }

  getStageDirector(): StageDirector {
    return this;
  }
}

/**
 * Helper class for mapping evaluation results to WebSocket responses
 */
export class StageDirectorHelper {
  /**
   * Maps an evaluation result to a WebSocket reply result
   */
  static mapOutput(
    stageDirector: StageDirector,
    transaction: WSEvaluateTransaction,
    result: EvalResult,
    output?: any,
    error?: Error,
    triggers?: Trigger[],
    extraStateUpdates?: Patch,
    customStage?: string,
    events?: HandlerEvent[]
  ): WSEvaluateReplyResult {
    const replyResult: WSEvaluateReplyResult = {};

    // Add triggers if provided
    if (triggers && triggers.length > 0) {
      replyResult.triggers = triggers;
    }

    // Add events if provided
    if (events && events.length > 0) {
      replyResult.events = events;
    }

    // Serialize output to state updates
    if (output !== undefined && output !== null) {
      if (!stageDirector.outputPath) {
        log.error(`Transaction ${transaction.transactionId} cannot store output as outputPath is missing`);
        if (!error) {
          error = newError(SDKErrors.MsgSDKDirectorOutputPathMissing);
          result = EvalResult.FIXABLE_ERROR;
        }
      } else {
        replyResult.stateUpdates = [{
          op: PatchOpType.ADD,
          path: stageDirector.outputPath,
          value: output
        }];
      }
    }

    // Append any extra state updates provided by the handler
    if (extraStateUpdates && extraStateUpdates.length) {
      replyResult.stateUpdates = (replyResult.stateUpdates || []).concat(extraStateUpdates);
    }

    // Set result based on evaluation outcome
    switch (result) {
      case EvalResult.HARD_FAILURE: {
        // Check if failureStage is missing (validation inside switch for failure-stage handling)
        const failureStage = stageDirector.failureStage;
        if (!failureStage && !customStage) {
          log.error(`Transaction ${transaction.transactionId} cannot be transitioned due to missing failureStage`);
          if (!error) {
            error = newError(SDKErrors.MsgSDKDirectorFailureStageMissing);
          }
          // Fall through to error handling below by breaking and letting default case handle it
          replyResult.error = error.message;
          log.debug(`Transaction ${transaction.transactionId} encountered error: ${error.message}`);
        } else {
          // Successfully transitioning to failure stage
          const next = customStage || failureStage;
          replyResult.stage = next;

          // Store error in state at /error path
          if (error) {
            if (!replyResult.stateUpdates) {
              replyResult.stateUpdates = [];
            }
            replyResult.stateUpdates.push({
              op: PatchOpType.ADD,
              path: '/error',
              value: error.message
            });
          }
          log.debug(`Transaction ${transaction.transactionId} directed to failureStage '${next}'`);
        }
        break;
      }
      case EvalResult.COMPLETE: {
        const next = customStage || stageDirector.nextStage;
        if (!next) {
          error = newError(SDKErrors.MsgSDKDirectorNextStageMissing);
          return { error: error.message };
        }
        replyResult.stage = next;
        log.debug(`Transaction ${transaction.transactionId} evaluated successfully and will transition to nextStage '${next}'`);
        break;
      }
      case EvalResult.WAITING:
        log.debug(`Transaction ${transaction.transactionId} evaluated successfully and will remain in stage`);
        break;
      case EvalResult.FIXABLE_ERROR:
      case EvalResult.TRANSIENT_ERROR:
      default:
        if (error) {
          replyResult.error = error.message;
          log.debug(`Transaction ${transaction.transactionId} encountered error: ${error.message}`);
        }
        break;
    }

    return replyResult;
  }
}

/**
 * Evaluate a batch of directed transactions
 * 
 * This is the core function that processes a batch of transactions using the
 * StageDirector pattern. It groups transactions by action, executes them according
 * to their invocation mode (PARALLEL or BATCH), and maps the results back to
 * the workflow engine's expected format.
 * 
 * @param reply The reply object to populate with results
 * @param batch The batch of transactions to process
 * @param actionMap Map of action names to their configurations
 * @param parseInput Function to parse transaction input
 * 
 * @example
 * ```typescript
 * evalDirected(reply, batch, actionMap, (input) => input as MyInput);
 * ```
 */
export async function evalDirected<T extends WithStageDirector>(
  reply: WSHandleTransactionsResult,
  batch: WSHandleTransactions,
  actionMap: Map<string, DirectedActionConfig<T>>
): Promise<void> {
  reply.results = new Array(batch.transactions.length);

  const byAction = new Map<string, ExecutableTransaction<T>[]>();

  // Phase 1: Parse inputs and group by action
  for (let i = 0; i < batch.transactions.length; i++) {
    const req = batch.transactions[i];
    log.debug(`Transaction id=${req.transactionId},workflow=${req.workflowId},stage=${req.stage} evaluating`);

    const execReq: ExecutableTransaction = { idx: i, transaction: req, input: {} as T };

    try {
      // Direct type assertion for transaction input (JSON-deserialized generic type)
      execReq.input = req.input as T;

      // Check if input is valid (not null or undefined)
      if (!execReq.input) {
        throw newError(SDKErrors.MsgSDKInputNullOrUndefined, req.stage);
      }

      // If input doesn't have getStageDirector method (plain object from JSON),
      // wrap it to provide the method
      if (typeof execReq.input.getStageDirector !== 'function') {
        const plainInput = execReq.input as any;

        // Validate that the plain input has the required action field
        if (!plainInput.action) {
          throw newError(
            SDKErrors.MsgSDKMissingActionField,
            req.stage,
            Object.keys(plainInput).join(', ')
          );
        }

        execReq.input = {
          ...plainInput,
          getStageDirector: () => ({
            action: plainInput.action,
            outputPath: plainInput.outputPath,
            nextStage: plainInput.nextStage,
            failureStage: plainInput.failureStage
          })
        } as T;
      }
    } catch (error) {
      log.error(`Transaction id=${req.transactionId} could not be parsed: ${error}`);
      reply.results[i] = {
        error: `Input parsing error: ${getErrorMessage(error)}`
      };
      continue;
    }

    const sd = execReq.input.getStageDirector();
    const actionConf = actionMap.get(sd.action);

    if (!actionConf) {
      reply.results[i] = {
        error: `Invalid action '${sd.action}' for handler '${batch.handler}'`
      };
      continue;
    }

    if (!byAction.has(sd.action)) {
      byAction.set(sd.action, []);
    }
    byAction.get(sd.action)!.push(execReq);
  }

  // Phase 2: Execute transactions by action
  const completions: Promise<ExecutableTransaction>[] = [];

  for (const [actionName, transactions] of byAction) {
    const actionConf = actionMap.get(actionName)!;

    switch (actionConf.invocationMode) {
      case InvocationMode.PARALLEL:
        // Execute each transaction in parallel
        for (const req of transactions) {
          completions.push(
            (async () => {
              req.result = await execMapped(actionConf, req.transaction, req.input);
              return req;
            })()
          );
        }
        break;

      case InvocationMode.BATCH: {
        // Execute all transactions for this action as a batch
        // Note: We execute the batch as one async operation, but add each
        // individual transaction to completions
        const batchPromise = (async () => {
          const batchIn: DirectedTransactionBatchIn<T>[] = transactions.map(r => ({
            transaction: r.transaction,
            value: r.input
          }));

          const batchOut = await execBatchMapped(actionConf, batchIn);

          for (let i = 0; i < transactions.length; i++) {
            transactions[i].result = batchOut[i];
          }

          return transactions;
        })();

        // Add each transaction as a separate completion to maintain flat array structure
        for (const req of transactions) {
          completions.push(
            batchPromise.then(() => req)
          );
        }
        break;
      }
    }
  }

  // Phase 3: Wait for all completions and collect results
  const completed = await Promise.all(completions);
  for (const execReq of completed) {
    if (execReq.result) {
      reply.results[execReq.idx] = execReq.result;
    }
  }
}

/**
 * Execute a single mapped transaction
 */
async function execMapped<T extends WithStageDirector>(
  config: DirectedActionConfig<T>,
  transaction: WSEvaluateTransaction,
  input: T
): Promise<WSEvaluateReplyResult> {
  try {
    if (!config.handler) {
      throw newError(SDKErrors.MsgSDKHandlerNotConfigured);
    }
    const handlerResult = await config.handler(transaction, input);
    const { result, output, error, triggers, extraUpdates, customStage, events } = handlerResult as {
      result: EvalResult;
      output?: any;
      error?: Error;
      triggers?: Trigger[];
      events?: HandlerEvent[];
      extraUpdates?: Patch;
      customStage?: string;
    };
    return StageDirectorHelper.mapOutput(
      input.getStageDirector(),
      transaction,
      result,
      output,
      error,
      triggers,
      extraUpdates,
      customStage,
      events
    );
  } catch (error) {
    log.error(`Handler execution failed:`, error);
    return {
      error: getErrorMessage(error)
    };
  }
}

/**
 * Execute a batch of mapped transactions
 */
async function execBatchMapped<T extends WithStageDirector>(
  config: DirectedActionConfig<T>,
  transactions: DirectedTransactionBatchIn<T>[]
): Promise<WSEvaluateReplyResult[]> {
  if (!config.batchHandler) {
    throw newError(SDKErrors.MsgSDKBatchHandlerNotConfigured);
  }

  try {
    const batchResults = await config.batchHandler(transactions);

    if (batchResults.length !== transactions.length) {
      throw newError(SDKErrors.MsgSDKBatchHandlerResultCountMismatch, batchResults.length, transactions.length);
    }

    return transactions.map((req, i) => {
      const batchResult = batchResults[i];
      return StageDirectorHelper.mapOutput(
        req.value.getStageDirector(),
        req.transaction,
        batchResult.result,
        batchResult.output,
        batchResult.error,
        batchResult.triggers,
        batchResult.extraUpdates,
        batchResult.customStage
      );
    });
  } catch (error) {
    log.error(`Batch handler execution failed:`, error);
    return transactions.map(() => ({
      error: getErrorMessage(error)
    }));
  }
}

