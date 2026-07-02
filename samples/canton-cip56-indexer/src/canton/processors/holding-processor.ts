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

import type { CantonContractEvent, HoldingView, BatchContext } from '../types.js';
import {
  shortPartyName,
  normalizeAddr,
  contractInfoBlock,
  baseLabels,
  extractInstrumentId,
  extractIssuer,
  toBaseUnits,
} from '../helpers.js';

/**
 * Process a newly created CIP-56 Holding contract.
 *
 * A Holding represents a token balance on the Canton ledger. This handler
 * creates five types of AM entities from a single Holding event:
 *
 * 1. Fragment — the UTXO-like balance record, keyed by owner/contractId.
 * 2. Asset — the token type (e.g. "USDCx"), created once per instrumentId.
 * 3. Pool — the issuer-specific liquidity pool, created once per issuer/instrument.
 * 4. Addresses — owner and issuer party addresses with role annotations.
 * 5. Transfer — a balance-add record. If the Holding was created as part of
 *    a TI acceptance (txContext has sender/receiver), the transfer is enriched
 *    with from/to and labeled as a "receive". Otherwise it's a plain
 *    "holding_created" event (e.g. mint).
 */
export function handleHoldingCreated(
  ce: CantonContractEvent,
  view: HoldingView,
  ctx: BatchContext,
): void {
  const owner = normalizeAddr(view.owner);
  const issuer = normalizeAddr(extractIssuer(view));
  const instId = extractInstrumentId(view);
  const poolRef = `${issuer}/${instId}`;
  const amount = toBaseUnits(String(view.amount));

  // Register both owner and issuer as addresses for the batch upsert.
  if (owner) ctx.addressSet.add(owner);
  if (issuer) ctx.addressSet.add(issuer);

  // Create role-annotated address entries (deduplicated by address:role key).
  ctx.addAddress({
    address: owner,
    displayName: shortPartyName(owner),
    info: { partyId: owner, role: 'owner' },
    updateType: 'create_or_ignore',
  });
  ctx.addAddress({
    address: issuer,
    displayName: shortPartyName(issuer),
    info: { partyId: issuer, role: 'issuer' },
    updateType: 'create_or_ignore',
  });

  // Register the token asset (once per instrumentId across the batch).
  if (!ctx.assetMap.has(instId)) {
    ctx.assetMap.set(instId, {
      name: instId,
      displayName: instId,
      labels: {
        chain: 'canton',
        standard: 'CIP-56',
        instrumentId: instId,
        admin: issuer,
      },
      updateType: 'create_or_ignore',
    });
  }

  // Register the issuer's liquidity pool (once per issuer/instrument pair).
  if (!ctx.poolMap.has(poolRef)) {
    ctx.poolMap.set(poolRef, {
      name: instId,
      address: issuer,
      standard: 'CIP-56',
      asset: instId,
      description: `CIP-56 holding pool for ${instId} issued by ${shortPartyName(issuer)} on Canton`,
      labels: {
        chain: 'canton',
        standard: 'CIP-56',
        instrumentId: instId,
      },
      updateType: 'create_or_ignore',
    });
  }

  // Create the fragment (UTXO record) representing this Holding's balance.
  // Locked holdings (e.g. pending transfer acceptance) get an extra label.
  const fragKey = `${owner}/${ce.contractId}`;
  ctx.fragmentMap.set(fragKey, {
    name: ce.contractId,
    address: owner,
    value: amount,
    valueReference: ce.contractId,
    asset: instId,
    displayName: `${ce.entityName} ${view.amount} ${instId}`,
    description: `CIP-56 holding of ${view.amount} ${instId} owned by ${shortPartyName(owner)}, issued by ${shortPartyName(issuer)} on Canton`,
    info: {
      ...contractInfoBlock(ce),
      synchronizerId: ce.synchronizerId,
      holdingView: view,
      updateId: ce.updateId,
    },
    labels: {
      ...baseLabels('CIP-56', 'holding'),
      instrumentId: instId,
      owner,
      issuer,
      ...(view.lock ? { locked: 'true' } : {}),
    },
    updateType: 'create_or_replace',
  });

  // Emit a balance-add transfer. If this Holding was created as part of a
  // TI acceptance, enrich the transfer with the sender from txContext so
  // it shows as "Receive from alice" rather than "Holding created".
  const txInfo = ctx.txContext.get(ce.transactionId);
  const isTransfer = !!txInfo;
  const displayAmount = String(view.amount);
  ctx.transfers.push({
    protocolId: `${ce.transactionId}/${ce.contractId}/created`,
    ...(txInfo?.sender ? { from: txInfo.sender } : {}),
    to: owner,
    amount,
    transactionHash: ce.transactionId,
    parent: { type: 'pool', ref: poolRef },
    displayName: isTransfer
      ? `Receive ${displayAmount} ${instId}`
      : `Holding created ${displayAmount} ${instId}`,
    description: isTransfer
      ? `CIP-56 receiving transfer of ${displayAmount} ${instId} from ${shortPartyName(txInfo!.sender)} to ${shortPartyName(owner)} on Canton`
      : `CIP-56 holding of ${displayAmount} ${instId} created for ${shortPartyName(owner)} on Canton`,
    info: {
      offset: ce.offset,
      contractId: ce.contractId,
      effectiveAt: ce.effectiveAt,
    },
    balanceChanges: [
      { address: owner, operation: 'add', amount },
    ],
    labels: {
      chain: 'canton',
      standard: 'CIP-56',
      type: isTransfer ? 'transfer' : 'holding_created',
      ...(isTransfer ? { direction: 'receive' } : {}),
      ...(txInfo?.contractId ? { transferInstructionId: txInfo.contractId } : {}),
    },
    updateType: 'create_or_replace',
  });
}
