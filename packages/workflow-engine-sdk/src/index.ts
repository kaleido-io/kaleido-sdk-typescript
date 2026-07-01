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
  ServerConfig,
  ServerTlsConfig,
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
} from "./client/rest-client";

export {
  WorkflowEngineConfig,
  ConfigLoader,
  KALEIDO_CONFIG_FILE,
  WFE_CONFIG_FILE,
  CONFIG_FILE,
} from './config/config';

export {
  ProviderBase,
  ProviderConfig,
} from './provider/provider-base';

export {
  kidColon,
  kidDash,
} from './utils/kidutils';

export {
  HandlerSet,
  handlerSetFor,
  createWorkflowEngineClient,
} from './client/client_factory';

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export * from "./types/core";
export * from "./interfaces/handlers";
export * from "./interfaces/messages";

// ============================================================================
// Factories & Helpers
// ============================================================================

// Transaction handler factory
export {
  createTransactionHandler,
  TransactionHandlerBuilder,
} from "./factories/transaction_handler";

// Event source factory
export {
  createEventSource,
  EventSourceBuilder,
  EventSourceConf,
  EventSourceEvent,
  EventSourcePollFn,
  EventSourceBuildInitialCheckpointFn,
  EventSourceDeleteFn,
  EventSourceConfigParserFn,
} from "./factories/event_source";

// Event processor factory
export {
  createEventProcessor,
  EventProcessorBuilder,
  EventProcessorEvent,
  EventProcessorBatchFn,
} from './factories/event_processor';

// Indexer factory
export { createIndexer } from './factories/indexer';

// Stage director helpers
export {
  BasicStageDirector,
  StageDirectorHelper,
  evalDirected,
} from "./helpers/stage_director";

// Configuration
export * from "./config/config";

// WFE-specific WS proxy adapter
export {
  WSProxyAdapter,
  ProxyAdapterRuntime,
} from "./service/index";

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
} from "./utils/patch";

export {
  formatError,
  fatalError,
} from "./utils/errors";

export * from "./i18n/errors";

export type { HandlerBindingTarget } from "./types/flows";

export { HandlerRuntimeMode } from "./runtime/handler_runtime";

// ── Builder API ───────────────────────────────────────────────────────────────

export type { IndexerContext } from './app/context';
export { createIndexerContext } from './app/context';
export type { IndexerHandlerDef, TransactionHandlerRegistration } from './app/types';
export { ensureStream } from './stream/ensure-stream';
export type { EnsureStreamOptions } from './stream/ensure-stream';
