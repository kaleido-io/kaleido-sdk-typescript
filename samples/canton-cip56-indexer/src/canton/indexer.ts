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

import { newLogger } from '@kaleido-io/core-sdk/log';
import type { EventProcessorEvent, IndexerContext } from '@kaleido-io/workflow-engine-sdk';
import type { SetupContext } from '@kaleido-io/core-sdk/context';
import { CantonConnectorClient } from '@kaleido-io/connector-sdk/canton';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import type {
  AddressBulkInput as Address,
  AssetBulkInput as Asset,
  FragmentBulkInput as Fragment,
  PoolBulkInput as Pool,
  TransferBulkInput as Transfer,
} from '@kaleido-io/asset-manager-sdk';
import type { CantonContractEvent, TransferContext, BatchContext, HoldingView } from './types.js';
import { shortPartyName, findHoldingView, extractTransferData, isCreate, isArchive } from './helpers.js';
import { scanCreates, scanContextAndMisses, resolveAMMisses } from './processors/batch-scanner.js';
import { handleArchived, resolveFromEvent } from './processors/archive-processor.js';
import { handleHoldingCreated } from './processors/holding-processor.js';
import { handleTICreated } from './processors/ti-processor.js';
import type { CantonConfig } from '../config.js';

const log = newLogger('canton-cip56-indexer');

/**
 * CIP-56 event processor for Canton contract events.
 *
 * This is the pipeline orchestrator. It receives batches of Canton ledger
 * events from the Workflow Engine and transforms them into Asset Manager
 * entities (fragments, transfers, addresses, assets, pools).
 *
 * Batch pipeline (executed for each WFE batch):
 *
 *   1. Scan 1 (scanCreates) — build batch-local maps from created events.
 *   2. Scan 2 (scanContextAndMisses) — restore cross-batch transfer context,
 *      collect contractIds that need AM lookup.
 *   3. Query (resolveAMMisses) — single batched AM bulk-query for all misses.
 *   4. Process — dispatch each event to the appropriate handler.
 *   5. Flush — single bulkUpsert with all collected entities.
 *   6. Evict — remove processed transactionIds from the cross-batch cache.
 *
 * State model:
 *   - No persistent caches for contract or TI data; all state is batch-local.
 *   - A bounded `txTransferContext` map bridges TI exercise → Holding
 *     enrichment across WFE batches. Entries are evicted after each batch
 *     that references their transactionId.
 *   - On cache miss (contract created in a prior batch), the Asset Manager
 *     is queried for the existing fragment.
 */
export class CantonCIP56Indexer {
  /** Cross-batch cache: transactionId → TransferContext from exercised TIs. */
  private readonly txTransferContext = new Map<string, TransferContext>();

  async setup(ctx: SetupContext<CantonConfig>): Promise<void> {
    if (ctx.config.stream) {
      await new CantonConnectorClient(ctx.config.stream.connectorBindingName).ensureStream(ctx, {
        factory: ctx.config.stream.factory,
        name: ctx.config.stream.name,
        description: ctx.config.stream.description,
        eventSourceConfig: ctx.config.stream.eventSourceConfig,
      });
    }
  }

  async indexBatch(
    ctx: IndexerContext<CantonConfig>,
    events: EventProcessorEvent<CantonContractEvent>[],
  ): Promise<void> {
    log.debug(`Batch received: ${events.length} events`);

    const am = new AssetManagerClient(ctx);

    // ── Scan passes ───────────────────────────────────────────────
    // Pass 1: index all created contracts and TIs in this batch.
    const { contracts, batchTI } = scanCreates(events);
    // Pass 2: link TI exercises to transfer context, find cache misses.
    const { txContext, archiveMisses, tiMisses, exerciseEvents, txIdsInBatch } =
      scanContextAndMisses(events, contracts, batchTI, this.txTransferContext);

    // ── AM query ──────────────────────────────────────────────────
    // Resolve archive and TI misses by querying AM for stored fragments.
    await resolveAMMisses(
      archiveMisses, tiMisses, exerciseEvents,
      contracts, txContext, this.txTransferContext, am,
    );

    // ── Process: dispatch events, collect entities ────────────────
    // Initialize batch-local entity collections for the bulk upsert.
    const fragmentMap = new Map<string, Fragment>();
    const transfers: Transfer[] = [];
    const addressMap = new Map<string, Address>();
    const assetMap = new Map<string, Asset>();
    const poolMap = new Map<string, Pool>();
    const addressSet = new Set<string>();

    // Deduplicates addresses by address:role key so the same party can
    // appear as both "owner" and "issuer" without conflict.
    const addAddress = (addr: Address) => {
      const role = (addr.info as Record<string, unknown>)?.role ?? '';
      const key = `${addr.address}:${role}`;
      if (!addressMap.has(key)) addressMap.set(key, addr);
    };

    const batchCtx: BatchContext = {
      fragmentMap, transfers, addressMap, assetMap, poolMap, addressSet,
      txContext, contracts, addAddress,
    };

    // Dispatch each event to the appropriate handler based on event type.
    for (const event of events) {
      const ce = event.data;

      log.debug(
        `EVENT ${ce.eventType} ${ce.entityName} offset=${ce.offset} txId=${ce.transactionId} contractId=${ce.contractId}`,
      );

      if (isCreate(ce)) {
        // Created event: check for Holding view first, then TI data.
        const holdingIV = findHoldingView(ce);
        if (holdingIV?.viewValue) {
          handleHoldingCreated(ce, holdingIV.viewValue as unknown as HoldingView, batchCtx);
        } else {
          const td = extractTransferData(ce);
          if (td) handleTICreated(ce, td, batchCtx);
        }
      } else if (isArchive(ce)) {
        // Archive/exercise: look up the contract info (from batch maps,
        // AM query results, or last-resort event parsing).
        const info = contracts.get(ce.contractId) ?? resolveFromEvent(ce);
        if (info) {
          handleArchived(ce, info, batchCtx);
        } else {
          log.warn(
            `Skipping archive — unknown owner for contractId=${ce.contractId}`,
          );
        }
      }
    }

    // ── Flush all collected entities via a single bulkUpsert ──────
    const fragments = Array.from(fragmentMap.values());
    const assets = Array.from(assetMap.values());
    const pools = Array.from(poolMap.values());

    if (
      fragments.length > 0 ||
      transfers.length > 0 ||
      addressSet.size > 0 ||
      assets.length > 0 ||
      pools.length > 0
    ) {
      // Backfill plain address entries for any parties that were only
      // added to addressSet (not via addAddress with a role).
      for (const addr of addressSet) {
        const key = `${addr}:`;
        if (!addressMap.has(key)) {
          addressMap.set(key, {
            address: addr,
            displayName: shortPartyName(addr),
            info: { partyId: addr },
            updateType: 'create_or_ignore',
          });
        }
      }

      await am.bulkUpsert({
        addresses: Array.from(addressMap.values()),
        assets,
        pools,
        fragments,
        transfers,
      });
      log.info(
        `Upserted ${fragments.length} fragments, ${transfers.length} transfers, ${addressSet.size} addresses, ${assets.length} assets, ${pools.length} pools`,
      );
    }

    // ── Evict txTransferContext for completed transactions ─────────
    // Bound memory by removing entries for transactionIds that were fully
    // processed in this batch. If the same txId spans multiple batches
    // (rare), the entry persists until the last batch referencing it.
    for (const txId of txIdsInBatch) {
      this.txTransferContext.delete(txId);
    }

  }

}
