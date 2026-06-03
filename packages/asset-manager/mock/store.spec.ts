// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, beforeEach } from "@jest/globals";
import { AssetManagerStore } from "./store.js";
import { MockAssetManagerClient } from "./mock-client.js";
import { EventBatchDelivery } from "./events.js";
import { counterIds } from "./ids.js";

describe("AssetManagerStore — relational core", () => {
  let store: AssetManagerStore;

  beforeEach(() => {
    store = new AssetManagerStore({ idGenerator: counterIds("k") });
  });

  it("resolves a pool's asset ref by name and denormalizes onto the pool", () => {
    store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
    });
    const asset = store.findByIdentity<{ id: string }>("assets", "usd")!;
    const pool = store.findByIdentity<{ asset: string }>("pools", "0xAAA/main")!;
    expect(pool.asset).toBe(asset.id);
  });

  it("auto-resolves a polymorphic parent ref on data and copies asset down", () => {
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

  it("throws when filtering parent.ref without parent.type", () => {
    store.seed({
      assets: [{ name: "usd" }],
      events: [{ name: "e1", activity: "act1" } as any],
      activities: [{ name: "act1" }],
    });
    expect(() =>
      store.bulkQuery({
        events: {
          equal: [{ field: "parent.ref", value: "usd" }],
        },
      }),
    ).toThrow(/parent\.type/);
  });

  it("queries events for an asset by name (auto-resolved at query time)", () => {
    store.seed({
      assets: [{ name: "usd" }],
      activities: [{ name: "act1" }],
      events: [
        {
          name: "e1",
          activity: "act1",
          parent: { type: "asset", ref: "usd" },
        } as any,
      ],
    });
    const out = store.bulkQuery({
      events: {
        equal: [
          { field: "parent.type", value: "asset" },
          { field: "parent.ref", value: "usd" },
        ],
      },
    });
    expect(out.events?.count).toBe(1);
    expect(out.events?.items[0].name).toBe("e1");
  });

  it("supports label filtering with eq/in/neq + pagination", () => {
    store.seed({
      addresses: [
        { address: "0x1", labels: { ownership: "user", owner: "alice" } },
        { address: "0x2", labels: { ownership: "user", owner: "bob" } },
        { address: "0x3", labels: { ownership: "org" } },
      ],
    });
    const out = store.bulkQuery({
      addresses: {
        labels: {
          eq: [{ field: "ownership", value: "user" }],
          neq: [{ field: "owner", value: "bob" }],
        },
        limit: 10,
      },
    });
    expect(out.addresses?.count).toBe(1);
    expect(out.addresses?.items[0].address).toBe("0x1");
  });

  it("cascades deletes from address → pool → balanceChanges", () => {
    store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
      transfers: [
        {
          protocolId: "t1",
          transactionHash: "0xhash",
          parent: { type: "pool", ref: "0xAAA/main" },
          from: "0x0000000000000000000000000000000000000000",
          to: "0xUSER",
          amount: "100",
        },
      ],
    });
    expect(store.transfers).toHaveLength(1);
    expect(store.balanceChanges.length).toBeGreaterThan(0);

    store.delete("addresses", "0xAAA");

    expect(store.pools).toHaveLength(0);
    expect(store.transfers).toHaveLength(0);
    expect(store.balanceChanges).toHaveLength(0);
  });
});

describe("balance bookkeeping", () => {
  it("computes balanceBefore/balanceAfter across a sequence of transfers", () => {
    const store = new AssetManagerStore({ idGenerator: counterIds("k") });
    store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
      transfers: [
        {
          protocolId: "t1",
          transactionHash: "0xhash1",
          parent: { type: "pool", ref: "0xAAA/main" },
          from: "0x0000000000000000000000000000000000000000",
          to: "0xUSER",
          amount: "1000",
        },
      ],
    });
    store.seed({
      transfers: [
        {
          protocolId: "t2",
          transactionHash: "0xhash2",
          parent: { type: "pool", ref: "0xAAA/main" },
          from: "0xUSER",
          to: "0xMERCH",
          amount: "300",
        },
      ],
    });
    const all = store.balanceChanges.filter((b) => b.address === "0xUSER");
    // First transfer adds 1000, second subtracts 300.
    const sorted = [...all].sort((a, b) =>
      String(a.created).localeCompare(String(b.created)),
    );
    expect(sorted[0].balanceBefore).toBe("0");
    expect(sorted[0].balanceAfter).toBe("1000");
    expect(sorted[1].balanceBefore).toBe("1000");
    expect(sorted[1].balanceAfter).toBe("700");
  });
});

describe("event subscriptions and delivery", () => {
  it("delivers a matching event to a registered listener on flush", async () => {
    const am = new MockAssetManagerClient({ idGenerator: counterIds("k") });
    await am.replaceSubscription("blockchain-events", {
      name: "blockchain-events",
      topicFilter: "erc20/.*",
    });
    const received: EventBatchDelivery[] = [];
    am.listen("blockchain-events", (batch) => {
      received.push(batch);
    });

    am.store.seed({
      activities: [{ name: "erc20" }],
      events: [
        {
          name: "Minted",
          activity: "erc20",
        } as any,
      ],
    });

    expect(received).toHaveLength(0); // manual mode: nothing fires yet
    await am.flushEvents();

    expect(received).toHaveLength(1);
    expect(received[0].stream).toBe("blockchain-events");
    expect(received[0].events).toHaveLength(1);
    expect(received[0].events[0].topic).toBe("erc20/Minted");
    expect(received[0].batchNumber).toBe(1);
  });

  it("does not deliver events whose topic does not match", async () => {
    const am = new MockAssetManagerClient({ idGenerator: counterIds("k") });
    await am.replaceSubscription("only-erc20", {
      name: "only-erc20",
      topicFilter: "erc20/.*",
    });
    const received: EventBatchDelivery[] = [];
    am.listen("only-erc20", (b) => {
      received.push(b);
    });
    am.store.seed({
      activities: [{ name: "commitment" }],
      events: [{ name: "Settled", activity: "commitment" } as any],
    });
    await am.flushEvents();
    expect(received).toHaveLength(0);
  });

  it("replays events after subscriptionReset", async () => {
    const am = new MockAssetManagerClient({ idGenerator: counterIds("k") });
    await am.replaceSubscription("all", { name: "all", topicFilter: "" });
    const received: EventBatchDelivery[] = [];
    am.listen("all", (b) => {
      received.push(b);
    });

    am.store.seed({
      activities: [{ name: "act" }],
      events: [{ name: "E1", activity: "act" } as any],
    });
    await am.flushEvents();
    expect(received).toHaveLength(1);

    await am.subscriptionReset("all", { sequenceId: "1" });
    await am.flushEvents();
    expect(received).toHaveLength(2);
    expect(received[1].events[0].name).toBe("E1");
  });
});

describe("MockAssetManagerClient API surface", () => {
  it("is structurally an AssetManagerClient", () => {
    const am = new MockAssetManagerClient();
    // Spot-check a few inherited methods exist on the mock.
    expect(typeof am.getAssets).toBe("function");
    expect(typeof am.bulkUpsert).toBe("function");
    expect(typeof am.getAssetBalances).toBe("function");
  });

  it("returns latest balance per pool/address via getAssetBalances", async () => {
    const am = new MockAssetManagerClient({ idGenerator: counterIds("k") });
    am.store.seed({
      assets: [{ name: "usd" }],
      addresses: [{ address: "0xAAA" }],
      pools: [{ name: "main", address: "0xAAA", asset: "usd" }],
      transfers: [
        {
          protocolId: "t1",
          transactionHash: "0x1",
          parent: { type: "pool", ref: "0xAAA/main" },
          from: "0x0000000000000000000000000000000000000000",
          to: "0xUSER",
          amount: "500",
        },
      ],
    });
    const bal = await am.getAssetBalances("usd");
    expect(bal.count).toBe(1);
    expect(bal.items[0].balanceAfter).toBe("500");
    expect(bal.items[0].address).toBe("0xUSER");
  });

  it("throws MOCK000 for out-of-scope task methods", async () => {
    const am = new MockAssetManagerClient();
    await expect(am.invokeTask("foo", { input: {} } as any)).rejects.toThrow(
      /MOCK000/,
    );
  });
});
