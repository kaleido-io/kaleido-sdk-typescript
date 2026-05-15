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

import {
  EngineAPI,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
  newLogger,
} from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '../clients/asset-manager/client.js';
import type { BulkQueryInput, BulkQueryOutput } from '../clients/asset-manager/bulkquery.js';
import type {
  Address,
  Asset,
  Fragment,
  Pool,
  Transfer,
} from '../clients/asset-manager/models.js';
import type { CantonContractEvent, ContractInterfaceView } from './types.js';
import { shortPartyName, normalizeAddr, contractInfoBlock, baseLabels } from './helpers.js';

// ── Types ─────────────────────────────────────────────────────────────

type ContractInfo = {
  owner: string;
  amount?: string;
  asset?: string;
  poolRef?: string;
};

type TransferContext = {
  sender: string;
  receiver: string;
  amount?: string;
  instrumentId?: string;
  contractId?: string;
};

type BatchContext = {
  fragmentMap: Map<string, Fragment>;
  transfers: Transfer[];
  addressMap: Map<string, Address>;
  assetMap: Map<string, Asset>;
  poolMap: Map<string, Pool>;
  addressSet: Set<string>;
  txContext: Map<string, TransferContext>;
  contracts: Map<string, ContractInfo>;
  addAddress: (addr: Address) => void;
};

// ── CIP-56 view types ───────────────────────────────────────────────

const HOLDING_INTERFACE = 'Splice.Api.Token.HoldingV1:Holding';
const TRANSFER_INSTRUCTION_INTERFACE =
  'Splice.Api.Token.TransferInstructionV1:TransferInstruction';

type HoldingView = {
  owner: string;
  amount: string;
  instrumentId?: {
    admin?: string;
    id?: string;
  };
  lock?: unknown;
  meta?: {
    values?: Record<string, string>;
  };
};

type TransferData = {
  sender: string;
  receiver: string;
  amount: string;
  instrumentId?: {
    admin?: string;
    id?: string;
  };
};

// ── CIP-56 helpers ──────────────────────────────────────────────────

function findHoldingView(
  ce: CantonContractEvent,
): ContractInterfaceView | undefined {
  return ce.interfaceViews?.find((iv) =>
    iv.interfaceId?.includes(HOLDING_INTERFACE),
  );
}

/**
 * Extract transfer data from interface views or template arguments.
 *
 * The CIP-56 TransferInstruction view nests data under .transfer:
 *   { transfer: { sender, receiver, amount, instrumentId }, status, meta }
 *
 * When interfaceViews is not populated by the connector, we fall back to
 * arguments.transfer.
 */
function extractTransferData(ce: CantonContractEvent): TransferData | null {
  const iv = ce.interfaceViews?.find((v) =>
    v.interfaceId?.includes(TRANSFER_INSTRUCTION_INTERFACE),
  );
  if (iv?.viewValue) {
    const view = iv.viewValue as Record<string, unknown>;
    const transfer = (view.transfer ?? view) as Record<string, unknown>;
    if (transfer.sender || transfer.receiver) {
      return {
        sender: (transfer.sender as string) ?? '',
        receiver: (transfer.receiver as string) ?? '',
        amount: (transfer.amount as string) ?? '0',
        instrumentId: transfer.instrumentId as TransferData['instrumentId'],
      };
    }
  }

  const args = (ce.arguments ?? {}) as Record<string, unknown>;
  const transfer = args.transfer as Record<string, unknown> | undefined;
  if (transfer?.sender || transfer?.receiver) {
    return {
      sender: (transfer.sender as string) ?? '',
      receiver: (transfer.receiver as string) ?? '',
      amount: (transfer.amount as string) ?? '0',
      instrumentId: transfer.instrumentId as TransferData['instrumentId'],
    };
  }

  return null;
}

function extractInstrumentId(view: HoldingView): string {
  return view.instrumentId?.id ?? 'KLD';
}

function extractIssuer(view: HoldingView): string {
  return view.instrumentId?.admin ?? '';
}

/**
 * Convert a Daml Decimal string to integer base units.
 *
 * Daml's Decimal type is Numeric 10 (38 total digits, 10 fractional).
 * We multiply by 10^10 so the Asset Manager can store amounts as integers,
 * similar to how BTC amounts are stored in satoshis (x 10^8).
 *
 * Examples:
 *   "33.1081975897" -> "331081975897"
 *   "1000"          -> "10000000000000"
 *   "0.0000000001"  -> "1"
 */
const DAML_DECIMAL_SCALE = 10;

function toBaseUnits(amount: string): string {
  const negative = amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const [intPart, fracPart = ''] = abs.split('.');
  const padded = fracPart.padEnd(DAML_DECIMAL_SCALE, '0').slice(0, DAML_DECIMAL_SCALE);
  const raw = (intPart + padded).replace(/^0+/, '') || '0';
  return negative && raw !== '0' ? `-${raw}` : raw;
}

function isCreate(ce: CantonContractEvent): boolean {
  return ce.eventType === 'created';
}

function isArchive(ce: CantonContractEvent): boolean {
  return (
    ce.eventType === 'archived' ||
    (ce.eventType === 'exercised' && ce.consuming === true)
  );
}

// ── CIP-56 Indexer ──────────────────────────────────────────────────

/**
 * CIP-56 event processor for the Canton connector.
 *
 * Batch pipeline:
 *   Scan 1 — build batch-local maps from creates (contracts + TI context).
 *   Scan 2 — restore cross-batch transfer context, collect archive/TI misses.
 *   Query  — single batched AM bulk-query for all cache misses.
 *   Process — dispatch creates and archives, collect entities.
 *   Flush  — single bulkUpsert with all fragments, transfers, addresses, assets, pools.
 *
 * State model:
 *   - No persistent caches for contract or TI data; all state is batch-local.
 *   - A bounded txTransferContext bridges TI exercise → Holding enrichment
 *     across WFE batches, evicted after each batch that references the txId.
 *   - On cache miss (contract created in a prior batch), AM is queried
 *     for the existing fragment.
 */
export class CantonCIP56Indexer {
  private amClient: AssetManagerClient | undefined;
  private txTransferContext = new Map<string, TransferContext>();
  private log = newLogger('canton-cip56-indexer');

  name(): string {
    return 'canton-cip56-indexer';
  }

  async setup(amClient: AssetManagerClient): Promise<void> {
    this.amClient = amClient;
  }

  init(_engAPI: EngineAPI): Promise<void> {
    return Promise.resolve();
  }

  close(): void {}

  /**
   * Batched bulk query helper (adopted from btc-indexer).
   * Splits large lookups into 100-item chunks to avoid overloading the AM query API.
   */
  private async batchLookup<T>(
    lookups: string[],
    buildQuery: (batch: string[]) => BulkQueryInput,
    extractResults: (output: BulkQueryOutput) => T[],
    handleResults: (values: T[]) => void,
  ): Promise<void> {
    const BATCH_SIZE = 100;
    for (let i = 0; i < lookups.length; i += BATCH_SIZE) {
      const chunk = lookups.slice(i, i + BATCH_SIZE);
      const result = await this.amClient!.bulkQuery(buildQuery(chunk));
      handleResults(extractResults(result));
    }
  }

  async eventProcessorBatch(
    result: WSEventProcessorBatchResult,
    batch: WSEventProcessorBatchRequest,
  ): Promise<void> {
    this.log.debug(`Batch received: ${batch.events.length} events`);

    const contracts = new Map<string, ContractInfo>();
    const batchTI = new Map<string, TransferContext>();
    const txContext = new Map<string, TransferContext>();
    const archiveMisses = new Set<string>();
    const tiMisses: string[] = [];
    const exerciseEvents: CantonContractEvent[] = [];
    const txIdsInBatch = new Set<string>();

    // ── Scan 1: collect creates into batch-local maps ─────────────
    for (const event of batch.events) {
      const ce = event.data as CantonContractEvent;
      if (!isCreate(ce)) continue;

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

    // ── Scan 2: restore cross-batch context, collect misses ───────
    for (const event of batch.events) {
      const ce = event.data as CantonContractEvent;
      txIdsInBatch.add(ce.transactionId);

      if (!txContext.has(ce.transactionId)) {
        const prior = this.txTransferContext.get(ce.transactionId);
        if (prior) txContext.set(ce.transactionId, prior);
      }

      if (isArchive(ce) && !contracts.has(ce.contractId)) {
        archiveMisses.add(ce.contractId);
      }

      if (ce.eventType === 'exercised' && ce.consuming) {
        const tiInfo = batchTI.get(ce.contractId);
        if (tiInfo) {
          const ctx = { ...tiInfo, contractId: ce.contractId };
          txContext.set(ce.transactionId, ctx);
          this.txTransferContext.set(ce.transactionId, ctx);
          batchTI.delete(ce.contractId);
        } else if (!txContext.has(ce.transactionId)) {
          tiMisses.push(ce.contractId);
          exerciseEvents.push(ce);
        }
      }

      if (ce.eventType === 'archived') {
        batchTI.delete(ce.contractId);
      }
    }

    // ── AM query: resolve all misses in one batched call ──────────
    const allMisses = new Set([...archiveMisses, ...tiMisses]);
    if (allMisses.size > 0 && this.amClient) {
      const fragMap = new Map<string, Fragment>();
      await this.batchLookup<Fragment>(
        Array.from(allMisses),
        (chunk) => ({ fragments: { limit: chunk.length, in: [{ field: 'name', values: chunk }] } }),
        (output) => output.fragments?.items ?? [],
        (fragments) => {
          for (const f of fragments) {
            if (f.name) fragMap.set(f.name, f);
          }
        },
      );

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
          this.txTransferContext.set(ce.transactionId, ctx);
        }
      }
    }

    // ── Process: dispatch events, collect entities ────────────────
    const fragmentMap = new Map<string, Fragment>();
    const transfers: Transfer[] = [];
    const addressMap = new Map<string, Address>();
    const assetMap = new Map<string, Asset>();
    const poolMap = new Map<string, Pool>();
    const addressSet = new Set<string>();

    const addAddress = (addr: Address) => {
      const role = (addr.info as Record<string, unknown>)?.role ?? '';
      const key = `${addr.address}:${role}`;
      if (!addressMap.has(key)) addressMap.set(key, addr);
    };

    const ctx: BatchContext = {
      fragmentMap, transfers, addressMap, assetMap, poolMap, addressSet,
      txContext, contracts, addAddress,
    };

    for (const event of batch.events) {
      const ce = event.data as CantonContractEvent;

      this.log.debug(
        `EVENT ${ce.eventType} ${ce.entityName} offset=${ce.offset} txId=${ce.transactionId} contractId=${ce.contractId}`,
      );

      if (isCreate(ce)) {
        const holdingIV = findHoldingView(ce);
        if (holdingIV?.viewValue) {
          this.handleHoldingCreated(ce, holdingIV.viewValue as unknown as HoldingView, ctx);
        } else {
          const td = extractTransferData(ce);
          if (td) this.handleTICreated(ce, td, ctx);
        }
      } else if (isArchive(ce)) {
        const info = contracts.get(ce.contractId) ?? this.resolveFromEvent(ce);
        if (info) {
          this.handleArchived(ce, info, ctx);
        } else {
          this.log.warn(
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

      if (this.amClient) {
        await this.amClient.bulkUpsert({
          addresses: Array.from(addressMap.values()),
          assets,
          pools,
          fragments,
          transfers,
        });
        this.log.info(
          `Upserted ${fragments.length} fragments, ${transfers.length} transfers, ${addressSet.size} addresses, ${assets.length} assets, ${pools.length} pools`,
        );
      } else {
        this.log.warn(
          `[DRY-RUN] Would upsert ${fragments.length} fragments, ${transfers.length} transfers, ${addressSet.size} addresses, ${assets.length} assets, ${pools.length} pools (no AM client)`,
        );
      }
    }

    // ── Evict txTransferContext for completed transactions ─────────
    for (const txId of txIdsInBatch) {
      this.txTransferContext.delete(txId);
    }

    const lastEvent = batch.events[batch.events.length - 1];
    if (lastEvent) {
      result.checkpoint = { offset: (lastEvent.data as CantonContractEvent).offset };
    }
  }

  // ── Event-level fallback for owner resolution ──────────────────

  private resolveFromEvent(ce: CantonContractEvent): ContractInfo | undefined {
    const holdingIV = findHoldingView(ce);
    if (holdingIV?.viewValue) {
      const view = holdingIV.viewValue as unknown as HoldingView;
      return { owner: normalizeAddr(view.owner) };
    }
    const td = extractTransferData(ce);
    if (td) {
      return { owner: normalizeAddr(td.sender || ce.signatories?.[0] || '') };
    }
    return undefined;
  }

  // ── Holding created ────────────────────────────────────────────

  private handleHoldingCreated(
    ce: CantonContractEvent,
    view: HoldingView,
    ctx: BatchContext,
  ): void {
    const owner = normalizeAddr(view.owner);
    const issuer = normalizeAddr(extractIssuer(view));
    const instId = extractInstrumentId(view);
    const poolRef = `${issuer}/${instId}`;
    const amount = toBaseUnits(String(view.amount));

    if (owner) ctx.addressSet.add(owner);
    if (issuer) ctx.addressSet.add(issuer);

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

  // ── TransferInstruction created ────────────────────────────────

  private handleTICreated(
    ce: CantonContractEvent,
    td: TransferData,
    ctx: BatchContext,
  ): void {
    const sender = normalizeAddr(td.sender || ce.signatories?.[0] || '');
    const receiver = normalizeAddr(td.receiver || '');
    const rawAmount = td.amount || '0';
    const amount = toBaseUnits(rawAmount);
    const instId = td.instrumentId?.id || '';
    const admin = td.instrumentId?.admin || '';

    if (sender) ctx.addressSet.add(sender);
    if (receiver) ctx.addressSet.add(receiver);

    const fragKey = `${sender}/${ce.contractId}`;
    ctx.fragmentMap.set(fragKey, {
      name: ce.contractId,
      address: sender,
      value: amount,
      valueReference: ce.contractId,
      displayName: `TransferInstruction ${rawAmount} ${instId}`,
      description: `CIP-56 transfer instruction of ${rawAmount} ${instId} from ${shortPartyName(sender)} to ${shortPartyName(receiver)} on Canton`,
      info: {
        ...contractInfoBlock(ce),
        sender,
        receiver,
        instrumentId: td.instrumentId,
        interfaceViews: ce.interfaceViews,
      },
      labels: {
        ...baseLabels('CIP-56', 'transfer_instruction'),
        instrumentId: instId,
        admin,
        sender,
        receiver,
      },
      updateType: 'create_or_replace',
    });
  }

  // ── Archive handling ───────────────────────────────────────────

  private handleArchived(
    ce: CantonContractEvent,
    info: ContractInfo,
    ctx: BatchContext,
  ): void {
    if (info.amount && info.poolRef) {
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

    ctx.addressSet.add(info.owner);

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
}

export const cantonCip56Indexer = new CantonCIP56Indexer();
