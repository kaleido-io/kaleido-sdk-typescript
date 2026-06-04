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

import type { IDataModelClient, BulkQueryInput, BulkQueryOutput, Fragment } from '@kaleido-io/sdk';
import type {
  CantonContractEvent,
  ContractInfo,
  TransferContext,
  HoldingView,
  ScanCreatesResult,
  ScanContextResult,
} from '../types.js';
import {
  normalizeAddr,
  findHoldingView,
  extractTransferData,
  extractInstrumentId,
  extractIssuer,
  toBaseUnits,
  isCreate,
  isArchive,
} from '../helpers.js';

/**
 * Scan 1: build batch-local maps from created events.
 *
 * Iterates over all events in the batch. For each `created` event:
 *   - If it has a Holding interface view → extract owner, amount, instrument,
 *     and pool reference into the `contracts` map.
 *   - Otherwise, if it has TransferInstruction data → record the sender as
 *     owner in `contracts`, and store the full transfer context (sender,
 *     receiver, amount, instrument) in `batchTI` for later enrichment.
 *
 * Both maps are keyed by contractId.
 */
export function scanCreates(
  events: { data: unknown }[],
): ScanCreatesResult {
  const contracts = new Map<string, ContractInfo>();
  const batchTI = new Map<string, TransferContext>();

  for (const event of events) {
    const ce = event.data as CantonContractEvent;
    if (!isCreate(ce)) continue;

    // Try Holding interface view first — this is the primary contract type.
    const holdingIV = findHoldingView(ce);
    if (holdingIV?.viewValue) {
      const view = holdingIV.viewValue as unknown as HoldingView;
      const instId = extractInstrumentId(view);
      const issuer = normalizeAddr(extractIssuer(view));
      contracts.set(ce.contractId, {
        owner: normalizeAddr(view.owner),
        amount: toBaseUnits(String(view.amount)),
        asset: instId,
        poolRef: `${issuer}/${instId}`,
      });
    } else {
      // Fall back to TransferInstruction data (from interface view or arguments).
      // TIs don't carry balance but are tracked for transfer enrichment.
      const td = extractTransferData(ce);
      if (td) {
        const sender = normalizeAddr(td.sender || ce.signatories?.[0] || '');
        contracts.set(ce.contractId, { owner: sender });
        batchTI.set(ce.contractId, {
          sender,
          receiver: normalizeAddr(td.receiver),
          amount: td.amount,
          instrumentId: td.instrumentId?.id,
        });
      }
    }
  }

  return { contracts, batchTI };
}

/**
 * Scan 2: restore cross-batch transfer context and collect cache misses.
 *
 * Iterates over all events in the batch to:
 *
 * 1. Restore prior transfer context — if a transactionId was seen in a
 *    previous batch (stored in `txTransferContext`), copy it into the
 *    batch-local `txContext` so Holding creates in this batch can be
 *    enriched with sender/receiver info.
 *
 * 2. Collect archive misses — if an archive/exercise event references a
 *    contractId not found in the batch-local `contracts` map (i.e. it was
 *    created in a prior batch), add it to `archiveMisses` for AM lookup.
 *
 * 3. Promote TI exercises — when a TransferInstruction is consumed (exercised),
 *    promote its sender/receiver data from `batchTI` into `txContext` and
 *    persist it to `txTransferContext`. This links the TI to all Holding
 *    events sharing the same transactionId (the accept transaction).
 *    If the TI was created in a prior batch and isn't in `batchTI`,
 *    record it as a TI miss for AM lookup.
 *
 * 4. Clean up archived TIs — if a TI is archived (rejected/expired rather
 *    than exercised), remove it from `batchTI` so it won't incorrectly
 *    enrich any future Holdings.
 */
export function scanContextAndMisses(
  events: { data: unknown }[],
  contracts: Map<string, ContractInfo>,
  batchTI: Map<string, TransferContext>,
  txTransferContext: Map<string, TransferContext>,
): ScanContextResult {
  const txContext = new Map<string, TransferContext>();
  const archiveMisses = new Set<string>();
  const tiMisses: string[] = [];
  const exerciseEvents: CantonContractEvent[] = [];
  const txIdsInBatch = new Set<string>();

  for (const event of events) {
    const ce = event.data as CantonContractEvent;
    txIdsInBatch.add(ce.transactionId);

    // Restore transfer context from a prior batch (e.g. TI exercised in
    // batch N, Holding created in batch N+1 under the same transactionId).
    if (!txContext.has(ce.transactionId)) {
      const prior = txTransferContext.get(ce.transactionId);
      if (prior) txContext.set(ce.transactionId, prior);
    }

    // Archive/exercise of a contract not created in this batch — need to
    // query AM for the original fragment to know the owner, amount, etc.
    if (isArchive(ce) && !contracts.has(ce.contractId)) {
      archiveMisses.add(ce.contractId);
    }

    // Consuming exercise = TI acceptance. Promote the TI's sender/receiver
    // into transfer context so the resulting Holding events get enriched.
    if (ce.eventType === 'exercised' && ce.consuming) {
      const tiInfo = batchTI.get(ce.contractId);
      if (tiInfo) {
        // TI was created in this batch — promote it directly.
        const ctx = { ...tiInfo, contractId: ce.contractId };
        txContext.set(ce.transactionId, ctx);
        txTransferContext.set(ce.transactionId, ctx);
        batchTI.delete(ce.contractId);
      } else if (!txContext.has(ce.transactionId)) {
        // TI was created in a prior batch — need AM lookup to get
        // sender/receiver labels from the stored fragment.
        tiMisses.push(ce.contractId);
        exerciseEvents.push(ce);
      }
    }

    // TI archived (rejected/expired) — remove from batchTI so it won't
    // incorrectly enrich Holdings in a later transaction.
    if (ce.eventType === 'archived') {
      batchTI.delete(ce.contractId);
    }
  }

  return { txContext, archiveMisses, tiMisses, exerciseEvents, txIdsInBatch };
}

/**
 * Query Asset Manager to resolve all cache misses collected during scanning.
 *
 * Combines archive misses and TI misses into a single set and performs a
 * batched fragment lookup (100 IDs per chunk) against the AM bulk query API.
 *
 * For each resolved fragment:
 *   - Archive misses: reconstruct the ContractInfo (owner, amount, asset,
 *     pool reference) from the stored fragment so the archive handler can
 *     emit a subtract transfer and mark the fragment as spent.
 *   - TI misses: reconstruct the TransferContext (sender, receiver) from
 *     the fragment's labels so the Holding handler can enrich transfers
 *     with sender/receiver info (e.g. after a restart where the TI
 *     creation was processed in a previous run).
 */
export async function resolveAMMisses(
  archiveMisses: Set<string>,
  tiMisses: string[],
  exerciseEvents: CantonContractEvent[],
  contracts: Map<string, ContractInfo>,
  txContext: Map<string, TransferContext>,
  txTransferContext: Map<string, TransferContext>,
  dmClient: IDataModelClient,
): Promise<void> {
  const allMisses = new Set([...archiveMisses, ...tiMisses]);
  if (allMisses.size === 0) return;

  // Query AM for all missing contractIds in one batched call.
  // Fragment.name stores the contractId; we look them up by name.
  const fragMap = new Map<string, Fragment>();
  await batchLookup<Fragment>(
    dmClient,
    Array.from(allMisses),
    (chunk) => ({ fragments: { limit: chunk.length, in: [{ field: 'name', values: chunk }] } }),
    (output) => output.fragments?.items ?? [],
    (fragments) => {
      for (const f of fragments) {
        if (f.name) fragMap.set(f.name, f);
      }
    },
  );

  // Reconstruct ContractInfo for archived contracts from the AM fragment.
  // This restores the owner/amount/pool data that was originally written
  // when the contract was created, so handleArchived can emit a proper
  // subtract transfer and mark the fragment spent.
  for (const contractId of archiveMisses) {
    const frag = fragMap.get(contractId);
    if (frag?.address) {
      const issuer = normalizeAddr(frag.labels?.issuer ?? '');
      const instId = frag.labels?.instrumentId || frag.asset;
      contracts.set(contractId, {
        owner: normalizeAddr(frag.address),
        amount: frag.value,
        asset: instId,
        poolRef: issuer && instId ? `${issuer}/${instId}` : undefined,
      });
    }
  }

  // Reconstruct TransferContext for exercised TIs from the AM fragment.
  // TI fragments store sender/receiver in their labels. This data is
  // needed to enrich the Holding transfers that share the same
  // transactionId (the "accept" transaction).
  for (const ce of exerciseEvents) {
    const frag = fragMap.get(ce.contractId);
    if (frag?.labels?.sender) {
      const ctx: TransferContext = {
        sender: frag.labels.sender,
        receiver: frag.labels.receiver ?? '',
        instrumentId: frag.labels.instrumentId,
        contractId: ce.contractId,
      };
      txContext.set(ce.transactionId, ctx);
      txTransferContext.set(ce.transactionId, ctx);
    }
  }
}

/**
 * Generic chunked bulk query helper.
 *
 * Splits a large list of lookup keys into chunks of BATCH_SIZE (100) and
 * executes one AM bulkQuery per chunk. This avoids exceeding AM's query
 * size limits while keeping the number of round-trips minimal.
 */
async function batchLookup<T>(
  dmClient: IDataModelClient,
  lookups: string[],
  buildQuery: (batch: string[]) => BulkQueryInput,
  extractResults: (output: BulkQueryOutput) => T[],
  handleResults: (values: T[]) => void,
): Promise<void> {
  const BATCH_SIZE = 100;
  for (let i = 0; i < lookups.length; i += BATCH_SIZE) {
    const chunk = lookups.slice(i, i + BATCH_SIZE);
    const result = await dmClient.bulkQuery(buildQuery(chunk));
    handleResults(extractResults(result));
  }
}
