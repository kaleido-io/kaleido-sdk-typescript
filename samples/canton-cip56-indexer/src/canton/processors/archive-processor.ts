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

import type { CantonContractEvent, ContractInfo, BatchContext, HoldingView } from '../types.js';
import {
  shortPartyName,
  normalizeAddr,
  findHoldingView,
  extractTransferData,
} from '../helpers.js';

/**
 * Handle an archived or consuming-exercised contract (both Holdings and TIs).
 *
 * Two things happen:
 *
 * 1. Subtract transfer (Holdings only) — if the contract had a balance
 *    (amount + poolRef), emit a balance-subtract transfer. When a TI exercise
 *    produced this archive (txContext has sender/receiver), the transfer is
 *    labeled as a "send" with the receiver populated. Otherwise it's a plain
 *    "holding_archived" event (e.g. manual burn).
 *
 * 2. Mark fragment spent — update the fragment's `spent` label to 'true'.
 *    If the fragment was already created in this batch (same create+archive
 *    batch), update it in-place. Otherwise create a minimal "patch" fragment
 *    with `create_or_update` so AM only overwrites the spent label.
 */
export function handleArchived(
  ce: CantonContractEvent,
  info: ContractInfo,
  ctx: BatchContext,
): void {
  // Only Holdings carry a balance (amount + pool). TIs have neither, so
  // this block is skipped for TI archives — they only get marked spent.
  if (info.amount && info.poolRef) {
    // Check if this archive is part of a TI acceptance flow. If so, the
    // txContext carries the sender/receiver from the exercised TI.
    const txInfo = ctx.txContext.get(ce.transactionId);
    const isTransfer = !!txInfo;
    const asset = info.asset ?? '';
    ctx.transfers.push({
      protocolId: `${ce.transactionId}/${ce.contractId}/archived`,
      from: info.owner,
      ...(txInfo?.receiver ? { to: txInfo.receiver } : {}),
      amount: info.amount,
      transactionHash: ce.transactionId,
      parent: { type: 'pool', ref: info.poolRef },
      displayName: isTransfer
        ? `Send ${asset} to ${shortPartyName(txInfo!.receiver)}`
        : `Holding archived ${asset}`,
      description: isTransfer
        ? `CIP-56 sending transfer of ${asset} from ${shortPartyName(info.owner)} to ${shortPartyName(txInfo!.receiver)} on Canton`
        : `CIP-56 holding of ${asset} archived for ${shortPartyName(info.owner)} on Canton`,
      info: {
        offset: ce.offset,
        contractId: ce.contractId,
        effectiveAt: ce.effectiveAt,
      },
      balanceChanges: [
        { address: info.owner, operation: 'subtract', amount: info.amount },
      ],
      labels: {
        chain: 'canton',
        standard: 'CIP-56',
        type: isTransfer ? 'transfer' : 'holding_archived',
        ...(isTransfer ? { direction: 'send' } : {}),
        ...(txInfo?.contractId ? { transferInstructionId: txInfo.contractId } : {}),
      },
      updateType: 'create_or_replace',
    });
  }

  // Ensure the owner address is included in the batch for upsert.
  ctx.addressSet.add(info.owner);

  // Mark the fragment as spent. If the fragment was created earlier in the
  // same batch, flip its label in-place. Otherwise create a minimal patch
  // fragment — AM's create_or_update will only overwrite the labels field.
  const fragKey = `${info.owner}/${ce.contractId}`;
  const existing = ctx.fragmentMap.get(fragKey);
  if (existing) {
    existing.labels = { ...existing.labels, spent: 'true' };
  } else {
    ctx.fragmentMap.set(fragKey, {
      name: ce.contractId,
      address: info.owner,
      labels: { chain: 'canton', spent: 'true' },
      updateType: 'create_or_update',
    });
  }
}

/**
 * Last-resort owner resolution from the event payload itself.
 *
 * When an archive event references a contractId that wasn't found in the
 * batch-local maps or the AM query, try to extract the owner directly
 * from the event's interface views or arguments. This can happen when the
 * archive event carries the same data as the original create (some Canton
 * templates include view data on archive events).
 *
 * Returns undefined if no owner can be determined, in which case the
 * indexer will skip the archive with a warning.
 */
export function resolveFromEvent(ce: CantonContractEvent): ContractInfo | undefined {
  // Try Holding view first — the owner is directly available.
  const holdingIV = findHoldingView(ce);
  if (holdingIV?.viewValue) {
    const view = holdingIV.viewValue as unknown as HoldingView;
    return { owner: normalizeAddr(view.owner) };
  }
  // Fall back to TransferInstruction — the sender is the owner.
  const td = extractTransferData(ce);
  if (td) {
    return { owner: normalizeAddr(td.sender || ce.signatories?.[0] || '') };
  }
  return undefined;
}
