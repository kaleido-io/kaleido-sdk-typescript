// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { EventBatchDelivery } from "../../mock/events.js";
import type { ContractContext, ContractRegistrar } from "../types.js";
import {
  asMockClient,
  contractPrefix,
  queryEventByName,
  resourceName,
} from "../helpers.js";

export const registerSubscriptionScenarios: ContractRegistrar = (ctx) => {
  describe("event subscriptions and delivery", () => {
    let client: AssetManagerClient;
    let prefix: string;

    beforeEach(() => {
      client = ctx.createClient();
      prefix = contractPrefix(ctx);
    });

    it("delivers a matching event to a registered listener on flush", async () => {
      const subName = resourceName(prefix, "blockchain-events");
      const activityName = resourceName(prefix, "erc20");
      const eventName = resourceName(prefix, "Minted");
      const expectedTopic = `${activityName}/${eventName}`;
      const received: EventBatchDelivery[] = [];

      await client.replaceSubscription(subName, {
        name: subName,
        topicFilter: `${activityName}/.*`,
      });

      if (ctx.backend === "mock") {
        asMockClient(client).listen(subName, (batch) => {
          received.push(batch);
        });
      }

      await client.bulkUpsert({
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: eventName,
            activity: activityName,
            updateType: "create_or_replace",
          },
        ],
      });

      if (ctx.backend === "mock") {
        expect(received).toHaveLength(0);
        await asMockClient(client).flushEvents();
        expect(received).toHaveLength(1);
        expect(received[0].stream).toBe(subName);
        expect(received[0].events).toHaveLength(1);
        expect(received[0].events[0].topic).toBe(expectedTopic);
        expect(received[0].batchNumber).toBe(1);
      }

      const event = await queryEventByName(client, eventName);
      expect(event?.topic).toBe(expectedTopic);
    });

    it("does not deliver events whose topic does not match", async () => {
      const subName = resourceName(prefix, "only-erc20");
      const erc20Activity = resourceName(prefix, "erc20");
      const activityName = resourceName(prefix, "commitment");
      const eventName = resourceName(prefix, "Settled");
      const received: EventBatchDelivery[] = [];

      await client.replaceSubscription(subName, {
        name: subName,
        topicFilter: `${erc20Activity}/.*`,
      });

      if (ctx.backend === "mock") {
        asMockClient(client).listen(subName, (b) => {
          received.push(b);
        });
      }

      await client.bulkUpsert({
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: eventName,
            activity: activityName,
            updateType: "create_or_replace",
          },
        ],
      });

      if (ctx.backend === "mock") {
        await asMockClient(client).flushEvents();
        expect(received).toHaveLength(0);
      }

      const event = await queryEventByName(client, eventName);
      expect(event?.topic).toBe(`${activityName}/${eventName}`);
      expect(event?.topic).not.toMatch(new RegExp(`^${erc20Activity}/`));
    });

    it("replays events after subscriptionReset", async () => {
      const subName = resourceName(prefix, "all");
      const activityName = resourceName(prefix, "act");
      const eventName = resourceName(prefix, "E1");
      const received: EventBatchDelivery[] = [];

      await client.replaceSubscription(subName, { name: subName, topicFilter: "" });

      if (ctx.backend === "mock") {
        asMockClient(client).listen(subName, (b) => {
          received.push(b);
        });
      }

      await client.bulkUpsert({
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: eventName,
            activity: activityName,
            updateType: "create_or_replace",
          },
        ],
      });

      if (ctx.backend === "mock") {
        await asMockClient(client).flushEvents();
        expect(received).toHaveLength(1);

        await asMockClient(client).subscriptionReset(subName, {
          sequenceId: "1",
        });
        await asMockClient(client).flushEvents();
        expect(received).toHaveLength(2);
        expect(received[1].events[0].name).toBe(eventName);
      } else {
        await client.subscriptionReset(subName, { sequenceId: "1" });
      }

      const event = await queryEventByName(client, eventName);
      expect(event?.name).toBe(eventName);
    });

    it("delivers events in batches when batchSize is 1", async () => {
      const subName = resourceName(prefix, "batch");
      const activityName = resourceName(prefix, "act");
      const event1 = resourceName(prefix, "E1");
      const event2 = resourceName(prefix, "E2");
      const received: EventBatchDelivery[] = [];

      await client.replaceSubscription(subName, {
        name: subName,
        topicFilter: "",
        batchSize: 1,
      });

      if (ctx.backend === "mock") {
        asMockClient(client).listen(subName, (b) => {
          received.push(b);
        });
      }

      await client.bulkUpsert({
        activities: [{ name: activityName, updateType: "create_or_replace" }],
        events: [
          {
            name: event1,
            activity: activityName,
            updateType: "create_or_replace",
          },
          {
            name: event2,
            activity: activityName,
            updateType: "create_or_replace",
          },
        ],
      });

      if (ctx.backend === "mock") {
        await asMockClient(client).flushEvents();
        expect(received).toHaveLength(2);
        expect(received[0].events).toHaveLength(1);
        expect(received[1].events).toHaveLength(1);
      }

      const sub = await client.getSubscription(subName);
      expect(sub?.batchSize).toBe(1);

      const out = await client.bulkQuery({
        events: {
          equal: [{ field: "activity", value: activityName }],
        },
      });
      expect(out.events?.count).toBe(2);
    });
  });
};
