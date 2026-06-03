// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { ContractContext, ContractRegistrar } from "../types.js";
import {
  contractPrefix,
  expectMissingParentTypeError,
  resourceName,
  ZERO_ADDRESS,
} from "../helpers.js";

export const registerBulkQueryScenarios: ContractRegistrar = (ctx) => {
  describe("bulkQuery filters", () => {
    let client: AssetManagerClient;
    let prefix: string;

    beforeEach(() => {
      client = ctx.createClient();
      prefix = contractPrefix(ctx);
    });

    it("throws when filtering parent.ref without parent.type", async () => {
      const assetName = resourceName(prefix, "usd");
      const activityName = resourceName(prefix, "act1");
      const eventName = resourceName(prefix, "e1");

      await client.bulkUpsert({
        assets: [{ name: assetName, updateType: "create_or_replace" }],
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: eventName,
            activity: activityName,
            updateType: "create_or_replace",
          },
        ],
      });

      await expectMissingParentTypeError(() =>
        client.bulkQuery({
          events: {
            equal: [{ field: "parent.ref", value: assetName }],
          },
        }),
      );
    });

    it("queries events for an asset by name (auto-resolved at query time)", async () => {
      const assetName = resourceName(prefix, "usd");
      const activityName = resourceName(prefix, "act1");
      const eventName = resourceName(prefix, "e1");

      await client.bulkUpsert({
        assets: [{ name: assetName, updateType: "create_or_replace" }],
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: eventName,
            activity: activityName,
            parent: { type: "asset", ref: assetName },
            updateType: "create_or_replace",
          },
        ],
      });

      const out = await client.bulkQuery({
        events: {
          equal: [
            { field: "parent.type", value: "asset" },
            { field: "parent.ref", value: assetName },
          ],
        },
      });

      expect(out.events?.count).toBe(1);
      expect(out.events?.items[0].name).toBe(eventName);
    });

    it("supports label filtering with eq/in/neq + pagination", async () => {
      const tag = resourceName(prefix, "owner");
      await client.bulkUpsert({
        addresses: [
          {
            address: resourceName(prefix, "0x1"),
            labels: { ownership: tag, owner: "alice" },
            updateType: "create_or_replace",
          },
          {
            address: resourceName(prefix, "0x2"),
            labels: { ownership: tag, owner: "bob" },
            updateType: "create_or_replace",
          },
          {
            address: resourceName(prefix, "0x3"),
            labels: { ownership: "org" },
            updateType: "create_or_replace",
          },
        ],
      });

      const out = await client.bulkQuery({
        addresses: {
          labels: {
            eq: [{ field: "ownership", value: tag }],
            neq: [{ field: "owner", value: "bob" }],
          },
          limit: 10,
        },
      });

      expect(out.addresses?.count).toBe(1);
      expect(out.addresses?.items[0].address).toBe(resourceName(prefix, "0x1"));
    });

    it("queries transfers by parent pool ref", async () => {
      const assetName = resourceName(prefix, "usd");
      const addr = resourceName(prefix, "0xAAA");
      const poolName = `${addr}/main`;
      const protocolId = resourceName(prefix, "t1");

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
            to: resourceName(prefix, "0xUSER"),
            amount: "100",
            updateType: "create_or_replace",
          },
        ],
      });

      const out = await client.bulkQuery({
        transfers: {
          equal: [
            { field: "parent.type", value: "pool" },
            { field: "parent.ref", value: poolName },
          ],
        },
      });

      expect(out.transfers?.count).toBe(1);
      expect(out.transfers?.items[0].protocolId).toBe(protocolId);
    });
  });
};
