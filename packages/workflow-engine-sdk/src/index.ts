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
 * Kaleido Workflow Engine SDK - TypeScript
 */

// ============================================================================
// Client Entry Point
// ============================================================================

export {
  WorkflowEngineClient,
  WorkflowEngineClientConfig,
} from './client/client';

export {
  WorkflowEngineRestClient,
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  CreateTransactionRequest,
  CreateTransactionResponse,
  CreateStreamRequest,
  CreateStreamResponse,
  UpdateStreamRequest,
  TransactionInput,
} from './client/rest-client';

export {
  WorkflowEngineConfig,
  ConfigLoader,
} from './config/config';

export { newLogger } from './log/logger';

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export * from './types/core';
export * from './interfaces/handlers';
export * from './interfaces/messages';

// ============================================================================
// Factories & Helpers
// ============================================================================

// Transaction handler factory
export {
  newDirectedTransactionHandler,
  TransactionHandlerFactory,
} from './factories/transaction_handler';

// Event source factory
export {
  newEventSource,
  EventSourceFactory,
  EventSourceConf,
  EventSourceEvent,
  EventSourcePollFn,
  EventSourceBuildInitialCheckpointFn,
  EventSourceDeleteFn,
  EventSourceConfigParserFn,
} from './factories/event_source';

// Stage director helpers
export {
  BasicStageDirector,
  StageDirectorHelper,
  evalDirected,
} from './helpers/stage_director';

// Configuration
export * from './config/config';

// Utilities
// ============================================================================

// JSON Patch utilities
export {
  apply,
  addOp,
  removeOp,
  replaceOp,
  moveOp,
  copyOp,
  testOp,
} from './utils/patch';

// Logger
export * from './log/logger';

export * from './i18n/errors';

export type { HandlerBindingTarget } from './types/flows';

export { HandlerRuntimeMode } from './runtime/handler_runtime';
