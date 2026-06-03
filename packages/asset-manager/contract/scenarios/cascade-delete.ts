// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { ContractContext, ContractRegistrar } from "../types.js";
import { contractPrefix, resourceName, ZERO_ADDRESS } from "../helpers.js";

export const registerCascadeDeleteScenarios: ContractRegistrar = (ctx) => {
  describe("cascade delete", () => {
    let client: AssetManagerClient;
    let prefix: string;

    beforeEach(() => {
      client = ctx.createClient();
      prefix = contractPrefix(ctx);
    });

    it("deleting an address cascades pools, transfers, and balanceChanges", async () => {
      const assetName = resourceName(prefix, "usd");
      const addr = resourceName(prefix, "0xAAA");
      const poolName = `${addr}/main`;
      const protocolId = resourceName(prefix, "t1");
      const user = resourceName(prefix, "0xUSER");

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
        transfers: [
          {
            protocolId,
            transactionHash: "0xhash",
            parent: { type: "pool", ref: poolName },
            from: ZERO_ADDRESS,
            to: user,
            amount: "100",
            updateType: "create_or_replace",
          },
        ],
      });

      const beforeTransfers = await client.bulkQuery({
        transfers: {
          equal: [{ field: "protocolId", value: protocolId }],
        },
      });
      expect(beforeTransfers.transfers?.count).toBe(1);

      const beforeBalances = await client.bulkQuery({
        balanceChanges: {
          equal: [
            { field: "asset", value: assetName },
            { field: "address", value: user },
          ],
        },
      });
      expect(beforeBalances.balanceChanges?.count).toBeGreaterThan(0);

      await client.deleteAddress(addr);

      const pools = await client.bulkQuery({
        pools: {
          equal: [{ field: "address", value: addr }],
        },
      });
      expect(pools.pools?.count).toBe(0);

      const transfers = await client.bulkQuery({
        transfers: {
          equal: [{ field: "protocolId", value: protocolId }],
        },
      });
      expect(transfers.transfers?.count).toBe(0);

      const balances = await client.bulkQuery({
        balanceChanges: {
          equal: [
            { field: "asset", value: assetName },
            { field: "address", value: user },
          ],
        },
      });
      expect(balances.balanceChanges?.count).toBe(0);
    });
  });
};
