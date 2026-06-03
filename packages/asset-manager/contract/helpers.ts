// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "crypto";
import { expect } from "@jest/globals";
import type { AssetManagerClient } from "../src/asset-manager.js";
import type { MockAssetManagerClient } from "../mock/mock-client.js";
import type { ContractContext } from "./types.js";

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000";

/** Unique name prefix — real backend needs isolation per test. */
export function contractPrefix(ctx: ContractContext): string {
  return ctx.backend === "real"
    ? `contract-${randomUUID().slice(0, 8)}`
    : "contract";
}

export function resourceName(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

export function asMockClient(
  client: AssetManagerClient,
): MockAssetManagerClient {
  if (!("flushEvents" in client)) {
    throw new Error("Expected MockAssetManagerClient");
  }
  return client as MockAssetManagerClient;
}

/** Real AM returns asset as a KID string; mock uses a plain string id. */
export function assetRefId(ref: unknown): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === "string") return ref;
  if (typeof ref === "object" && ref !== null && "id" in ref) {
    return String((ref as { id: string }).id);
  }
  return undefined;
}

/** Verify a pool is linked to an asset (works on mock and real AM). */
export async function expectPoolLinkedToAsset(
  client: AssetManagerClient,
  poolName: string,
  assetName: string,
  assetId: string | undefined,
): Promise<void> {
  const poolOut = await client.bulkQuery({
    pools: {
      equal: [
        { field: "qualifiedName", value: poolName },
        { field: "asset", value: assetName },
      ],
    },
  });
  expect(poolOut.pools?.count).toBe(1);
  const pool = poolOut.pools?.items[0];
  const linkedAssetId = assetRefId(pool?.asset);
  if (linkedAssetId !== undefined) {
    expect(linkedAssetId).toBe(assetId);
  }
}

/** Latest balanceAfter for an address scoped to an asset via bulkQuery. */
export async function latestBalanceForAddress(
  client: AssetManagerClient,
  assetName: string,
  userAddress: string,
): Promise<string | undefined> {
  const out = await client.bulkQuery({
    balanceChanges: {
      equal: [
        { field: "asset", value: assetName },
        { field: "address", value: userAddress },
      ],
    },
  });
  const sorted = [...(out.balanceChanges?.items ?? [])].sort((a, b) =>
    String(a.created).localeCompare(String(b.created)),
  );
  return sorted.at(-1)?.balanceAfter;
}

export async function queryEventByName(
  client: AssetManagerClient,
  eventName: string,
) {
  const out = await client.bulkQuery({
    events: {
      equal: [{ field: "name", value: eventName }],
    },
  });
  return out.events?.items[0];
}

/** Assert bulkQuery rejects parent.ref without parent.type (mock throws; real returns 400). */
export async function expectMissingParentTypeError(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    throw new Error("expected bulkQuery to reject parent.ref without parent.type");
  } catch (err: unknown) {
    const ax = err as { message?: string; response?: { data?: unknown } };
    const detail =
      typeof ax.response?.data === "object"
        ? JSON.stringify(ax.response.data)
        : String(ax.response?.data ?? ax.message ?? err);
    expect(detail).toMatch(/parent\.type|KA09121/i);
  }
}
