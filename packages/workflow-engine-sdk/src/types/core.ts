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
 * Core types and enums for the Workflow Engine TypeScript SDK.
 */

export enum EvalResult {
  FIXABLE_ERROR = 0,
  TRANSIENT_ERROR = 1,
  HARD_FAILURE = 2,
  COMPLETE = 3,
  WAITING = 4,
}

export enum InvocationMode {
  PARALLEL = 0,
  BATCH = 1,
}

export enum WSMessageType {
  PROTOCOL_ERROR = "protocol_error",
  REGISTER_PROVIDER = "register_provider",
  REGISTER_HANDLER = "register_handler",
  EVALUATE = "evaluate",
  EVALUATE_RESULT = "evaluate_result",
  HANDLE_TRANSACTIONS = "handle_transactions",
  HANDLE_TRANSACTIONS_RESULT = "handle_transactions_result",
  EVENT_SOURCE_CONFIG = "event_source_config",
  EVENT_SOURCE_POLL = "event_source_poll",
  EVENT_SOURCE_POLL_RESULT = "event_source_poll_result",
  EVENT_SOURCE_VALIDATE_CONFIG = "event_source_validate_config",
  EVENT_SOURCE_VALIDATE_CONFIG_RESULT = "event_source_validate_config_result",
  EVENT_SOURCE_DELETE = "event_source_delete",
  EVENT_SOURCE_DELETE_RESULT = "event_source_delete_result",
  EVENT_PROCESSOR_BATCH = "event_processor_batch",
  EVENT_PROCESSOR_BATCH_RESULT = "event_processor_batch_result",
  ENGINE_API_SUBMIT_TRANSACTIONS = "engineapi_submit_transactions",
  ENGINE_API_SUBMIT_TRANSACTIONS_RESULT = "engineapi_submit_transactions_result",
}

export enum WSHandlerType {
  TRANSACTION_HANDLER = "transaction_handler",
  EVENT_PROCESSOR = "event_processor",
  EVENT_SOURCE = "event_source",
}

export enum PatchOpType {
  ADD = "add",
  REMOVE = "remove",
  REPLACE = "replace",
  MOVE = "move",
  COPY = "copy",
  TEST = "test",
}

/**
 * StageDirector controls action routing and output mapping
 */
export interface StageDirector {
  action: string;       // The action to perform within the handler (required)
  outputPath: string;   // JSON Patch path for writing the output (required)
  nextStage: string;    // the stage to move to on success (required)
  failureStage: string; // the stage to divert to on failure (required)
}

/**
 * Interface for types that can provide a StageDirector
 */
export interface WithStageDirector {
  getStageDirector(): StageDirector;
}

/**
 * JSON Patch operation following RFC6902
 */
export interface PatchOp {
  op: PatchOpType;
  path: string;
  from?: string;
  value?: any;
}

export type Patch = PatchOp[];

/**
 * Event trigger for flow correlation
 */
export interface Trigger {
  topic: string;
  ephemeral?: boolean;
}

/**
 * Event emitted by a handler
 */
export interface HandlerEvent {
  idempotencyKey?: string;
  topic: string;
  data: any;
}

/**
 * Flow runtime state information
 */
export interface FlowRuntimeState {
  handler: string;
  workflowId: string;
  transactionId: string;
  sequence: string;
  idempotencyKey?: string;
  stackDepth?: number;
  identity?: string;
  identityContext?: any;
  stage: string;
  state?: any;
  queueReduce?: any;
}

/**
 * Event attached to a transaction
 */
export interface WSEvaluateTransactionEvent {
  topic: string;
  data?: any;
}

/**
 * Individual evaluation transaction
 */
export interface WSEvaluateTransaction extends FlowRuntimeState {
  authRef?: string;
  input?: any;
  configProfile?: any;
  events?: WSEvaluateTransactionEvent[];
}

/**
 * Result for an individual transaction in a batch
 */
export interface WSEvaluateReplyResult {
  error?: string;
  stage?: string;
  subflow?: string;
  stateUpdates?: Patch;
  triggers?: Trigger[];
  events?: HandlerEvent[];
}

/**
 * WebSocket message envelope
 */
export interface WSHandlerEnvelope {
  messageType: WSMessageType;
  id: string;
  handlerType?: WSHandlerType;
  handler?: string;
  error?: string;
  authTokens?: Record<string, string>;
}

export interface WSEventProcessorBatchRequest extends WSHandlerEnvelope {
  streamName: string;
  streamId: string;
  events: ListenerEvent[];
  authRef?: string;
}

export interface WSEventProcessorBatchResult extends WSHandlerEnvelope {
  checkpoint?: any;
  events: ListenerEvent[];
}

/**
 * Transaction handling transaction (batch of evaluate transactions).
 */
export interface WSHandleTransactions extends WSHandlerEnvelope {
  transactions: WSEvaluateTransaction[];
}

/**
 * Transaction handling response (batch evaluate results).
 */
export interface WSHandleTransactionsResult extends WSHandlerEnvelope {
  results: WSEvaluateReplyResult[];
}

/**
 * Provider registration message
 */
export interface WSRegisterProvider extends WSHandlerEnvelope {
  providerName: string;
}

/**
 * Handler registration message
 */
export interface WSRegisterHandler extends WSHandlerEnvelope {
  // Additional fields for registration if needed
}

/**
 * Listener event
 */
export interface ListenerEvent {
  idempotencyKey: string;
  topic: string;
  data?: any;
}

/**
 * Event source configuration
 */
export interface WSEventStreamInfo {
  streamId: string;
  streamName: string;
}

export interface WSEventSourceConfig extends WSHandlerEnvelope {
  streamName: string;
  streamId: string;
  config?: any;
}

/**
 * Listener poll request
 */
export interface WSListenerPollRequest extends WSHandlerEnvelope {
  streamName: string;
  streamId: string;
  listenerName?: string;
  checkpoint?: any;
  authRef?: string;
}

/**
 * Listener poll result
 */
export interface WSListenerPollResult extends WSHandlerEnvelope {
  checkpoint?: any;
  events: ListenerEvent[];
}

export interface AsyncTransactionInput {
  idempotencyKey?: string;
  workflowId?: string;
  workflow: string;
  operation: string;
  input?: any;
  labels?: Record<string, string>;
}

export interface IdempotentSubmitResult {
  id: string;
  position: number;
  idempotencyKey?: string;
  preexisting?: boolean;
  rejectedError?: string;
}

export interface WSEngineAPIRequest {
  activeRequestId: string;
  authRef?: string;
}

export interface WSEngineAPISubmitTransactions extends WSHandlerEnvelope, WSEngineAPIRequest {
  transactions: AsyncTransactionInput[];
}

export interface WSEngineAPISubmitTransactionsResult extends WSHandlerEnvelope {
  submissions: IdempotentSubmitResult[];
}

/**
 * Action result for a single action
 */
export interface ActionResult {
  result: any; // EvalResult from SDK
  output?: any;
  error?: Error;
  triggers?: any[]; // Trigger[] from SDK
  extraUpdates?: Patch; // State updates to apply
  customStage?: string; // Custom stage to transition to (overrides nextStage)
}

/**
 * Internal type for tracking execution state during batch processing
 * Used by stage_director to manage transaction execution and results
 */
export interface ExecutableTransaction<T = any> {
  idx: number;                        // Index in the original batch
  transaction: WSEvaluateTransaction;         // The transaction being processed
  input: T;                           // Parsed input for the transaction
  result?: WSEvaluateReplyResult;     // Result after execution (if completed)
}
