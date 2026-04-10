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

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-invocation context that propagates through the async call chain.
 *
 * Set by HandlerRuntime when dispatching handler calls (transaction batches,
 * event processor batches, event source polls). For directed transaction
 * handlers, evalDirected nests a per-transaction context with the correct
 * authRef before each handler invocation.
 *
 * Read by WSProxyAdapter (for authRef on ServiceProxyRequest) and
 * EngineClient (for requestId / authTokens on EngineAPI calls).
 */
export interface InvocationContext {
  requestId: string;
  authTokens: Record<string, string>;
  authRef?: string;
}

/**
 * Module-level AsyncLocalStorage singleton.
 *
 * AsyncLocalStorage creates a store that automatically follows the async
 * call chain — each invocationContext.run() scope gets its own isolated
 * store, even when multiple handlers execute concurrently via Promise.all.
 */
export const invocationContext = new AsyncLocalStorage<InvocationContext>();
