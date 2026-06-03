// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { ContractContext, ContractRegistrar } from "../types.js";
import {
  assetRefId,
  contractPrefix,
  expectPoolLinkedToAsset,
  resourceName,
} from "../helpers.js";

export const registerBulkUpsertScenarios: ContractRegistrar = (ctx) => {
  describe("bulkUpsert graph", () => {
    let client: AssetManagerClient;
    let prefix: string;

    beforeEach(() => {
      client = ctx.createClient();
      prefix = contractPrefix(ctx);
    });

    it("upserts an inter-related graph in one call and denormalizes asset onto pool", async () => {
      const assetName = resourceName(prefix, "usd");
      const addr = resourceName(prefix, "0xttttt");
      const poolName = `${addr}/main`;
      const dataName = resourceName(prefix, "d1");

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
        data: [
          {
            name: dataName,
            parent: { type: "pool", ref: poolName },
            updateType: "create_or_replace",
          },
        ],
      });

      const asset = await client.getAsset(assetName);
      const poolOut = await client.bulkQuery({
        pools: {
          equal: [{ field: "qualifiedName", value: poolName }],
        },
      });
      const dataOut = await client.bulkQuery({
        data: {
          equal: [{ field: "name", value: dataName }],
        },
      });

      const pool = poolOut.pools?.items[0];
      const data = dataOut.data?.items[0];
      const assetId = asset?.id;

      expect(pool).toBeDefined();
      await expectPoolLinkedToAsset(client, poolName, assetName, assetId);
      expect(assetRefId(data?.asset)).toBe(assetId);
      expect(data?.parent?.ref).toBe(pool?.id);
    });

    it("creates address-scoped pool with qualifiedName", async () => {
      const assetName = resourceName(prefix, "eur");
      const addr = resourceName(prefix, "0xbbb");
      const fqName = `${addr}/treasury`;

      await client.bulkUpsert({
        assets: [{ name: assetName, updateType: "create_or_replace" }],
        addresses: [{ address: addr, updateType: "create_or_replace" }],
        pools: [
          {
            name: "treasury",
            address: addr,
            asset: assetName,
            updateType: "create_or_replace",
          },
        ],
      });

      const poolOut = await client.bulkQuery({
        pools: {
          equal: [{ field: "qualifiedName", value: fqName }],
        },
      });
      const pool = poolOut.pools?.items[0];
      expect(pool).toBeDefined();
      expect(pool?.address).toBe(addr);
      expect(pool?.name).toBe("treasury");
      expect(pool?.qualifiedName).toBe(fqName);
    });

    it("create_or_ignore does not replace an existing row", async () => {
      const assetName = resourceName(prefix, "gbp");

      await client.bulkUpsert({
        assets: [
          {
            name: assetName,
            displayName: "original",
            updateType: "create_or_replace",
          },
        ],
      });
      await client.bulkUpsert({
        assets: [
          {
            name: assetName,
            displayName: "ignored",
            updateType: "create_or_ignore",
          },
        ],
      });

      const asset = await client.getAsset(assetName);
      expect(asset?.displayName).toBe("original");
    });

    it("create_or_replace overwrites an existing row", async () => {
      const assetName = resourceName(prefix, "chf");

      await client.bulkUpsert({
        assets: [
          {
            name: assetName,
            displayName: "v1",
            updateType: "create_or_replace",
          },
        ],
      });
      const out = await client.bulkUpsert({
        assets: [
          {
            name: assetName,
            displayName: "v2",
            updateType: "create_or_replace",
          },
        ],
      });

      const asset = await client.getAsset(assetName);
      expect(asset?.displayName).toBe("v2");
      expect(out.assets?.replaced).toHaveLength(1);
    });
  });
};
