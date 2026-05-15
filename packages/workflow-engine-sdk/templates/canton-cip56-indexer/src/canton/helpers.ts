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

import type { CantonContractEvent, ContractInterfaceView, HoldingView, TransferData } from './types.js';
import { HOLDING_INTERFACE, TRANSFER_INSTRUCTION_INTERFACE } from './types.js';

// ── General helpers ─────────────────────────────────────────────────

/**
 * Extract the human-readable party name from a Canton party identifier.
 * Canton party IDs have the format "name::fingerprint" — this returns
 * just the name portion for display purposes.
 */
export function shortPartyName(partyId: string | undefined | null): string {
  if (!partyId) return '';
  return partyId.split('::')[0] ?? partyId;
}

/** Asset Manager lowercases all addresses — normalize to match. */
export function normalizeAddr(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Common contract metadata block included in every fragment's `info`.
 * Handlers can spread this and add extra fields on top.
 */
export function contractInfoBlock(ce: CantonContractEvent): Record<string, unknown> {
  return {
    contractId: ce.contractId,
    templateId: ce.templateId,
    transactionId: ce.transactionId,
    offset: ce.offset,
    effectiveAt: ce.effectiveAt,
    entityName: ce.entityName,
    moduleName: ce.moduleName,
    arguments: ce.arguments,
    signatories: ce.signatories,
    observers: ce.observers,
  };
}

/**
 * Build fragment labels with chain=canton, the given standard/type,
 * spent=false, and any extra labels.
 */
export function baseLabels(
  standard: string,
  type: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return { chain: 'canton', standard, type, spent: 'false', ...extra };
}

// ── CIP-56 view parsing ────────────────────────────────────────────

/**
 * Find the CIP-56 Holding interface view from an event's interfaceViews.
 * Returns undefined if the event doesn't carry a Holding view (i.e. it's
 * not a Holding contract, or the connector didn't populate views).
 */
export function findHoldingView(
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
export function extractTransferData(ce: CantonContractEvent): TransferData | null {
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

/** Extract the token instrument ID from a Holding view. Defaults to 'KLD'. */
export function extractInstrumentId(view: HoldingView): string {
  return view.instrumentId?.id ?? 'KLD';
}

/** Extract the token issuer (admin party) from a Holding view. */
export function extractIssuer(view: HoldingView): string {
  return view.instrumentId?.admin ?? '';
}

// ── Amount scaling ──────────────────────────────────────────────────

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

export function toBaseUnits(amount: string): string {
  const negative = amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const [intPart, fracPart = ''] = abs.split('.');
  const padded = fracPart.padEnd(DAML_DECIMAL_SCALE, '0').slice(0, DAML_DECIMAL_SCALE);
  const raw = (intPart + padded).replace(/^0+/, '') || '0';
  return negative && raw !== '0' ? `-${raw}` : raw;
}

// ── Event type predicates ───────────────────────────────────────────

/** True if this is a contract creation event. */
export function isCreate(ce: CantonContractEvent): boolean {
  return ce.eventType === 'created';
}

/**
 * True if this event removes a contract from the ledger.
 * Both explicit archives and consuming exercises (e.g. TI acceptance)
 * result in the contract being consumed.
 */
export function isArchive(ce: CantonContractEvent): boolean {
  return (
    ce.eventType === 'archived' ||
    (ce.eventType === 'exercised' && ce.consuming === true)
  );
}
