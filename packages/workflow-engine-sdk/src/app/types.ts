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

import type { TransactionHandler } from '../interfaces/handlers.js';
import type { EventProcessorEvent } from '../factories/event_processor.js';
import type { SetupContext, IndexerContext } from './context.js';

/**
 * Handler definition for an event-processor indexer.
 *
 * - `setup` — optional; called once before the WFE connection is established.
 *   Use it to call ensureStream, initialise assets/pools, or any other one-time work.
 * - `process` — called for every batch of events received from the WFE.
 */
export interface IndexerHandlerDef<CustomConfig = unknown, EventDataType = unknown> {
  setup?: (ctx: SetupContext<CustomConfig>) => Promise<void>;
  indexBatch: (
    ctx: IndexerContext<CustomConfig>,
    events: EventProcessorEvent<EventDataType>[],
  ) => Promise<{ events: EventProcessorEvent<EventDataType>[] }>;
}

/**
 * Handler registration for a WFE transaction handler.
 *
 * Supply the pre-built TransactionHandler (e.g. from createTransactionHandler)
 * plus an optional setup hook that runs before the WFE connection is established.
 */
export interface TransactionHandlerRegistration {
  setup?: (ctx: SetupContext<unknown>) => Promise<void>;
  handler: TransactionHandler;
}
