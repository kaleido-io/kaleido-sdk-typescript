// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { ContractContext, ContractRegistrar } from "../types.js";
import {
  contractPrefix,
  latestBalanceForAddress,
  resourceName,
  ZERO_ADDRESS,
} from "../helpers.js";

async function seedAssetPool(
  client: AssetManagerClient,
  prefix: string,
): Promise<{ assetName: string; addr: string; poolName: string }> {
  const assetName = resourceName(prefix, "usd");
  const addr = resourceName(prefix, "0xAAA");
  const poolName = `${addr}/main`;

  await client.bulkUpsert({
    assets: [{ name: assetName, updateType: "create_or_replace" }],
    addresses: [{ address: addr, updateType: "create_or_replace" }],
    pools: [
      {
        name: "main",
        address: addr,
        asset: assetName,
        updateType: "create_or_replace",
      },
    ],
  });

  return { assetName, addr, poolName };
}

export const registerBalanceScenarios: ContractRegistrar = (ctx) => {
  describe("balance bookkeeping", () => {
    let client: AssetManagerClient;
    let prefix: string;

    beforeEach(() => {
      client = ctx.createClient();
      prefix = contractPrefix(ctx);
    });

    it("mint → transfer → burn produces correct latest balances", async () => {
      const { assetName, poolName } = await seedAssetPool(client, prefix);
      const user = resourceName(prefix, "0xUSER");

      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "mint"),
            transactionHash: "0xhash1",
            parent: { type: "pool", ref: poolName },
            from: ZERO_ADDRESS,
            to: user,
            amount: "1000",
            updateType: "create_or_replace",
          },
        ],
      });
      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "xfer"),
            transactionHash: "0xhash2",
            parent: { type: "pool", ref: poolName },
            from: user,
            to: resourceName(prefix, "0xMERCH"),
            amount: "300",
            updateType: "create_or_replace",
          },
        ],
      });
      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "burn"),
            transactionHash: "0xhash3",
            parent: { type: "pool", ref: poolName },
            from: user,
            to: ZERO_ADDRESS,
            amount: "700",
            updateType: "create_or_replace",
          },
        ],
      });

      const balanceAfter = await latestBalanceForAddress(
        client,
        assetName,
        user,
      );
      expect(balanceAfter).toBe("0");
    });

    it("computes balanceBefore/balanceAfter across a sequence of transfers", async () => {
      const { assetName, poolName } = await seedAssetPool(client, prefix);
      const user = resourceName(prefix, "0xUSER");

      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "t1"),
            transactionHash: "0xhash1",
            parent: { type: "pool", ref: poolName },
            from: ZERO_ADDRESS,
            to: user,
            amount: "1000",
            updateType: "create_or_replace",
          },
        ],
      });
      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "t2"),
            transactionHash: "0xhash2",
            parent: { type: "pool", ref: poolName },
            from: user,
            to: resourceName(prefix, "0xMERCH"),
            amount: "300",
            updateType: "create_or_replace",
          },
        ],
      });

      const out = await client.bulkQuery({
        balanceChanges: {
          equal: [
            { field: "asset", value: assetName },
            { field: "address", value: user },
          ],
        },
      });
      const sorted = [...(out.balanceChanges?.items ?? [])].sort((a, b) =>
        String(a.created).localeCompare(String(b.created)),
      );
      expect(sorted[0].balanceBefore).toBe("0");
      expect(sorted[0].balanceAfter).toBe("1000");
      expect(sorted[1].balanceBefore).toBe("1000");
      expect(sorted[1].balanceAfter).toBe("700");
    });

    it("create_or_replace transfer by protocolId does not double balance", async () => {
      const { assetName, poolName } = await seedAssetPool(client, prefix);
      const user = resourceName(prefix, "0xUSER");
      const protocolId = resourceName(prefix, "replay");

      const transfer = {
        protocolId,
        transactionHash: "0xhash1",
        parent: { type: "pool" as const, ref: poolName },
        from: ZERO_ADDRESS,
        to: user,
        amount: "500",
        updateType: "create_or_replace" as const,
      };

      await client.bulkUpsert({ transfers: [transfer] });
      await client.bulkUpsert({ transfers: [transfer] });

      const balanceAfter = await latestBalanceForAddress(
        client,
        assetName,
        user,
      );
      expect(balanceAfter).toBe("500");
    });

    it("returns latest balance per pool/address", async () => {
      const { assetName, poolName } = await seedAssetPool(client, prefix);
      const user = resourceName(prefix, "0xUSER");

      await client.bulkUpsert({
        transfers: [
          {
            protocolId: resourceName(prefix, "t1"),
            transactionHash: "0x1",
            parent: { type: "pool", ref: poolName },
            from: ZERO_ADDRESS,
            to: user,
            amount: "500",
            updateType: "create_or_replace",
          },
        ],
      });

      const balanceAfter = await latestBalanceForAddress(
        client,
        assetName,
        user,
      );
      expect(balanceAfter).toBe("500");

      if (ctx.backend === "mock") {
        const bal = (await client.getAssetBalances(assetName))!;
        expect(bal.count).toBe(1);
        expect(bal.items[0].balanceAfter).toBe("500");
        expect(bal.items[0].address).toBe(user);
      }
    });
  });
};
