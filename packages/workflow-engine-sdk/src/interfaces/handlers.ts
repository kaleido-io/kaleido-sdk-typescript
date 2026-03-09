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
  EvalResult,
  InvocationMode,
  WSEvaluateTransaction,
  WSHandleTransactionsResult,
  WSHandleTransactions,
  WSEvaluateReplyResult,
  WSEventSourceConfig,
  WSListenerPollRequest,
  WSListenerPollResult,
  WithStageDirector,
  Trigger,
  Patch,
  AsyncTransactionInput,
  IdempotentSubmitResult,
  HandlerEvent,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
} from '../types/core';

/**
 * EngineAPI interface
 */
export interface EngineAPI {
  submitAsyncTransactions(authRef: string, transactions: AsyncTransactionInput[]): Promise<IdempotentSubmitResult[]>;
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
  eventSourcePoll(config: WSEventSourceConfig, result: WSListenerPollResult, request: WSListenerPollRequest): Promise<void>;

  /**
   * Validate the event source config
   */
  eventSourceValidateConfig(result: any, request: any): Promise<void>;

  /**
   * Delete the event source
  */
  eventSourceDelete(result: any, request: any): Promise<void>;
}

/**
 * Transaction handler interface
 */
export interface TransactionHandler extends Handler {
  transactionHandlerBatch(
    result: WSHandleTransactionsResult,
    batch: WSHandleTransactions
  ): Promise<void>;
}

/**
 * Event processor handler interface
 */
export interface EventProcessor extends Handler {
  eventProcessorBatch(
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
) => Promise<{ result: EvalResult; output?: any; error?: Error; triggers?: Trigger[]; events?: HandlerEvent[]; extraUpdates?: Patch; customStage?: string }>;

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
export interface DirectedTransactionBatchOut<_T extends WithStageDirector> {
  result: EvalResult;
  output?: any;
  error?: Error;
  triggers?: Trigger[];
  extraUpdates?: Patch;
  customStage?: string;
  events?: HandlerEvent[];
}

/**
 * Function type for handling batch directed transactions.
 */
export type DirectedTransactionBatchHandler<T extends WithStageDirector> = (
  transactions: DirectedTransactionBatchIn<T>[]
) => Promise<DirectedTransactionBatchOut<T>[]>;

/**
 * Configuration for a directed action
 */
export interface DirectedActionConfig<T extends WithStageDirector> {
  invocationMode: InvocationMode;
  handler?: DirectedTransactionHandler<T>;
  batchHandler?: DirectedTransactionBatchHandler<T>;
}

/**
 * Simple handler interface compatible with existing code
 */
export interface IHandler {
  init(): Promise<void>;
  handle(transactions: WSEvaluateTransaction[]): Promise<WSEvaluateReplyResult[]>;
  close?(): void; // Optional for backward compatibility
}

/**
 * Transaction handler for batch evaluation with services support
 */
export interface TransactionHandler<SVCS = any> extends Handler {
  transactionHandlerBatch(
    reply: WSHandleTransactionsResult,
    batch: WSHandleTransactions,
    svcs?: SVCS
  ): Promise<void>;
}

/**
 * Listener handler for event streams with services support
 */
export interface ListenerHandler<SVCS = any> extends Handler {
  /**
   * Configure the listener when it's first set up
   */
  configure?(config: WSEventSourceConfig, svcs?: SVCS): Promise<void>;

  /**
   * Poll for events and update the result object
   */
  poll(request: WSListenerPollRequest, svcs?: SVCS): Promise<WSListenerPollResult>;
}