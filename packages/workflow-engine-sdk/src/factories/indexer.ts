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

import type { IndexerHandlerDef } from '../app/types.js';
import type { SetupContext } from '@kaleido-io/core/context';
import type { IndexerContext } from '../app/context.js';
import type { EventProcessorEvent } from './event_processor.js';

/**
 * Create an indexer handler definition from a batch function.
 *
 * Equivalent to writing `{ indexBatch: batchFn }` directly, but consistent
 * with the `createEventSource` / `createTransactionHandler` factory style.
 *
 * @param batchFn - Called for every batch of events received from the WFE.
 * @param setup   - Optional setup hook called once before the WFE connection
 *                  is established. Use it to call `ensureStream`, initialise
 *                  assets/pools, or any other one-time work.
 *
 * @example
 * .indexer('my-indexer', createIndexer(async (_ctx, events) => {
 *   for (const event of events) await writeToStore(event.data);
 * }))
 */
export function createIndexer<C = unknown, E = unknown>(
  batchFn: (ctx: IndexerContext<C>, events: EventProcessorEvent<E>[]) => Promise<void>,
  setup?: (ctx: SetupContext<C>) => Promise<void>,
): IndexerHandlerDef<C, E> {
  return setup ? { setup, indexBatch: batchFn } : { indexBatch: batchFn };
}
