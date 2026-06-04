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

import type { CantonContractEvent, TransferData, BatchContext } from '../types.js';
import { shortPartyName, normalizeAddr, contractInfoBlock, baseLabels, toBaseUnits } from '../helpers.js';

/**
 * Process a newly created CIP-56 TransferInstruction contract.
 *
 * A TransferInstruction (TI) represents an in-flight token transfer that
 * has been proposed but not yet accepted by the receiver. It does NOT carry
 * a balance — the actual balance movement happens when the TI is exercised
 * (accepted) and new Holdings are created.
 *
 * This handler creates:
 *   - A fragment with type=transfer_instruction, storing sender/receiver
 *     in labels so they can be recovered if the indexer restarts before
 *     the TI is exercised.
 *   - No transfer record (balance changes only happen on Holding events).
 *
 * The sender/receiver labels on this fragment are critical: when the TI is
 * later exercised (consumed), the batch scanner or AM query reads these
 * labels to enrich the resulting Holding transfers with from/to information.
 */
export function handleTICreated(
  ce: CantonContractEvent,
  td: TransferData,
  ctx: BatchContext,
): void {
  // Determine sender — fall back to the first signatory if the TI data
  // doesn't specify one (some older templates may omit it).
  const sender = normalizeAddr(td.sender || ce.signatories?.[0] || '');
  const receiver = normalizeAddr(td.receiver || '');
  const rawAmount = td.amount || '0';
  const amount = toBaseUnits(rawAmount);
  const instId = td.instrumentId?.id || '';
  const admin = td.instrumentId?.admin || '';

  // Register both parties for the batch address upsert.
  if (sender) ctx.addressSet.add(sender);
  if (receiver) ctx.addressSet.add(receiver);

  // Create the TI fragment. Keyed by sender/contractId since the sender
  // is the "owner" of the transfer instruction.
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
