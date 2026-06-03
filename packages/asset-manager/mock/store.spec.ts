// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "@jest/globals";
import { AssetManagerStore } from "./store.js";
import { MockAssetManagerClient } from "./mock-client.js";
import { counterIds } from "./ids.js";

describe("AssetManagerStore — store internals", () => {
  it("resolves a pool's asset ref by name and denormalizes onto the pool", () => {
    const store = new AssetManagerStore({ idGenerator: counterIds("k") });
    store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
    });
    const asset = store.findByIdentity<{ id: string }>("assets", "usd")!;
    const pool = store.findByIdentity<{ asset: string }>(
      "pools",
      "0xAAA/main",
    )!;
    expect(pool.asset).toBe(asset.id);
  });

  it("auto-resolves a polymorphic parent ref on data and copies asset down", () => {
    const store = new AssetManagerStore({ idGenerator: counterIds("k") });
    store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
      data: [
        {
          name: "d1",
          parent: { type: "pool", ref: "0xAAA/main" },
        } as any,
      ],
    });
    const asset = store.findByIdentity<{ id: string }>("assets", "usd")!;
    const data = store.findByIdentity<{ asset?: string; parent: any }>(
      "data",
      "d1",
    )!;
    expect(data.asset).toBe(asset.id);
    expect(data.parent.ref).toBe(
      store.findByIdentity<{ id: string }>("pools", "0xAAA/main")!.id,
    );
  });
});

describe("MockAssetManagerClient API surface", () => {
  it("is structurally an AssetManagerClient", () => {
    const am = new MockAssetManagerClient();
    expect(typeof am.getAssets).toBe("function");
    expect(typeof am.bulkUpsert).toBe("function");
    expect(typeof am.getAssetBalances).toBe("function");
  });

  it("throws MOCK000 for out-of-scope task methods", async () => {
    const am = new MockAssetManagerClient();
    await expect(am.invokeTask("foo", { input: {} } as any)).rejects.toThrow(
      /MOCK000/,
    );
  });
});
