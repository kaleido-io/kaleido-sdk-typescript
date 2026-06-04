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


import {
  AsyncTransactionInput,
  EvalResult,
  HandlerEvent,
  IdempotentSubmitResult,
  InvocationMode,
  Patch,
  RequestContext,
  Trigger,
  WSEvaluateTransaction,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
  WSEventSourceConfig,
  WSHandleTransactions,
  WSHandleTransactionsResult,
  WSListenerPollRequest,
  WSListenerPollResult,
  WithStageDirector
} from '../types/core';

/**
 * EngineAPI interface
 */
export interface EngineAPI {
  submitAsyncTransactions(
    reqContext: RequestContext,
    authRef: string,
    transactions: AsyncTransactionInput[],
  ): Promise<IdempotentSubmitResult[]>;
}

export interface Handler {
  name(): string;
  init(engAPI: EngineAPI): Promise<void>;
  close(): void;
}

/**
 * Event source handler interface
 */
export interface EventSource extends Handler {

  /**
   * Poll for events and update the result object
   */
  eventSourcePoll(reqContext: RequestContext, config: WSEventSourceConfig, result: WSListenerPollResult, request: WSListenerPollRequest): Promise<void>;

  /**
   * Validate the event source config
   */
  eventSourceValidateConfig(reqContext: RequestContext, result: any, request: any): Promise<void>;

  /**
   * Delete the event source
  */
  eventSourceDelete(reqContext: RequestContext, result: any, request: any): Promise<void>;
}

/**
 * Transaction handler interface
 */
export interface TransactionHandler extends Handler {
  transactionHandlerBatch(
    reqContext: RequestContext,
    result: WSHandleTransactionsResult,
    batch: WSHandleTransactions
  ): Promise<void>;
}

/**
 * Event processor handler interface
 */
export interface EventProcessor extends Handler {
  eventProcessorBatch(
    reqContext: RequestContext,
    result: WSEventProcessorBatchResult,
    batch: WSEventProcessorBatchRequest
  ): Promise<void>;
}

/**
 * Function type for handling individual directed requests
 */
export type DirectedTransactionHandler<T extends WithStageDirector> = (
  transaction: WSEvaluateTransaction,
  input: T
) => Promise<{ result: EvalResult; output?: any; error?: Error; triggers?: Trigger[]; events?: HandlerEvent[]; extraUpdates?: Patch; customStage?: string; deadline?: string }>;

/**
 * Input for batch directed transaction handling
 */
export interface DirectedTransactionBatchIn<T extends WithStageDirector> {
  transaction: WSEvaluateTransaction;
  value: T;
}

/**
 * Output for batch directed transaction handling
 */
export interface DirectedTransactionBatchOut {
  result: EvalResult;
  output?: any;
  error?: Error;
  errorData?: any;
  triggers?: Trigger[];
  extraUpdates?: Patch;
  customStage?: string;
  events?: HandlerEvent[];
  deadline?: string;
}

/**
 * Function type for handling batch directed transactions.
 */
export type DirectedTransactionBatchHandler<T extends WithStageDirector> = (
  transactions: DirectedTransactionBatchIn<T>[]
) => Promise<DirectedTransactionBatchOut[]>;

/**
 * Configuration for a directed action
 */
export interface DirectedActionConfig<T extends WithStageDirector> {
  invocationMode: InvocationMode;
  handler?: DirectedTransactionHandler<T>;
  batchHandler?: DirectedTransactionBatchHandler<T>;
}

