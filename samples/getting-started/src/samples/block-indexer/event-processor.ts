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

import { createEventProcessor, newLogger } from '@kaleido-io/workflow-engine-sdk';

const log = newLogger('block-indexer');

/**
 * Event data produced by a blockchain token transfer event source.
 * The structure here is chain-agnostic — substitute the fields your
 * event source actually emits.
 */
export interface TokenTransferEvent {
  blockNumber: number;
  transactionHash: string;
  from: string;
  to: string;
  amount: string; // bigint serialised as decimal string
}

/**
 * Checkpoint recorded after each batch.
 *
 * The engine persists this value and makes it available for operator
 * observability (e.g. monitoring dashboards). It is NOT returned to the
 * processor in subsequent batch requests — position tracking for the
 * underlying chain lives in the event source checkpoint, not here.
 *
 * Using the highest block number seen in the batch gives operators a
 * meaningful, incrementing signal of indexing progress.
 */

export const tokenTransferIndexer = createEventProcessor<TokenTransferEvent>(
  'token-transfer-indexer',
  async (_reqContext, events) => {
    if (events.length === 0) return;

    let highestBlock = 0;
    for (const event of events) {
      log.info(`Indexing transfer in block ${event.data.blockNumber}: ${event.data.from} -> ${event.data.to} (${event.data.amount})`);
      if (event.data.blockNumber > highestBlock) {
        highestBlock = event.data.blockNumber;
      }
    }
  }
);
