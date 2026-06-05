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

export * from '@kaleido-io/workflow-engine-sdk';
export * from '@kaleido-io/asset-manager-sdk';
export { loadConfig } from './config/config.js';
// Legacy abstract-class API (deprecated — use KaleidoApp instead)
export { Indexer, IndexerConfig } from './indexer/indexer.js';
// Logger is exported by both packages (WFE's logger interface and core's HTTP logger).
// Explicitly re-export WFE's Logger to resolve the ambiguity.
export type { Logger } from '@kaleido-io/workflow-engine-sdk';

// ── New builder API ──────────────────────────────────────────────────────────
export { KaleidoApp } from './app/kaleido-app.js';
export type { SetupContext, IndexerContext } from './app/context.js';
export type { IndexerHandlerDef, TransactionHandlerRegistration } from './app/types.js';
export { ensureStream } from './stream/ensure-stream.js';
export type { EnsureStreamOptions } from './stream/ensure-stream.js';
