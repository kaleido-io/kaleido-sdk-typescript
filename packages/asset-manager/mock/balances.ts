// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  BalanceChange,
  BalanceChangeInput,
  Transfer,
} from "../src/asset-manager.interfaces.js";
import { IdGenerator, nowIso } from "./ids.js";

const NIL_ADDRESS = "0x0000000000000000000000000000000000000000";

function isNilAddress(addr: string | undefined): boolean {
  if (!addr) return true;
  return addr.toLowerCase() === NIL_ADDRESS;
}

/**
 * Big-decimal-friendly add/sub using BigInt.
 * Transfer amounts are arbitrary-precision in production.
 */
function bigAdd(a: string | undefined, b: string | undefined): string {
  return (BigInt(a ?? "0") + BigInt(b ?? "0")).toString();
}
function bigSub(a: string | undefined, b: string | undefined): string {
  return (BigInt(a ?? "0") - BigInt(b ?? "0")).toString();
}

export interface BalanceBookkeepingContext {
  /** Pointer-to-latest: keyed on `<parent-ref-id>|<address-lowercase>`. */
  latestBalances: Map<string, BalanceChange>;
  idGenerator: IdGenerator;
  clock?: () => number;
}

export function balanceKey(parentRefId: string, address: string): string {
  return `${parentRefId}|${address.toLowerCase()}`;
}

/**
 * For a freshly written transfer, generate balance-change rows the
 * way the Go server does in `transfers.go:88–184`.
 *
 * Caller is responsible for storing the returned rows and updating
 * the `latestBalances` map.
 *
 * `transfer.parent.ref` MUST already be resolved to a KID by the
 * caller (the store does this before calling us).
 */
export function generateBalanceChanges(
  transfer: Transfer,
  parentRefId: string,
  ctx: BalanceBookkeepingContext,
): BalanceChange[] {
  const explicit = transfer.balanceChanges;

  // Empty array means "auto-generation disabled" — match server.
  if (Array.isArray(explicit) && explicit.length === 0) return [];

  const inputs: BalanceChangeInput[] = explicit ?? [];

  if (!explicit) {
    if (!isNilAddress(transfer.from) && transfer.from && transfer.amount) {
      inputs.push({
        address: transfer.from,
        operation: "subtract",
        amount: transfer.amount,
      });
    }
    if (!isNilAddress(transfer.to) && transfer.to && transfer.amount) {
      inputs.push({
        address: transfer.to,
        operation: "add",
        amount: transfer.amount,
      });
    }
  }

  const out: BalanceChange[] = [];
  inputs.forEach((bci, index) => {
    if (!bci.address) return;
    const key = balanceKey(parentRefId, bci.address);
    const prev = ctx.latestBalances.get(key);
    const before = prev?.balanceAfter ?? "0";
    const after =
      bci.operation === "subtract"
        ? bigSub(before, bci.amount)
        : bigAdd(before, bci.amount);

    const now = nowIso(ctx.clock);
    const bc: BalanceChange = {
      id: ctx.idGenerator(),
      created: now,
      updated: now,
      name: `${transfer.protocolId}/${String(index).padStart(6, "0")}`,
      transfer: transfer.id,
      asset: transfer.asset,
      parent: transfer.parent,
      address: bci.address,
      operation: bci.operation,
      amount: bci.amount,
      balanceBefore: before,
      balanceAfter: after,
    };
    out.push(bc);
    ctx.latestBalances.set(key, bc);
  });

  return out;
}
