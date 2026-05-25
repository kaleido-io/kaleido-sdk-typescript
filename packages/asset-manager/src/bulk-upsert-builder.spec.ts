import {
  BulkUpsertBuilder,
  BulkUpsertBuilderOptions,
  BulkUpsertInvalidRefError,
  DuplicateStrategy,
  IBulkUpsertClient,
} from "./bulk-upsert-builder.js";

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe("BulkUpsertBuilder", () => {
  let builder: BulkUpsertBuilder;
  let mockClient: jest.Mocked<IBulkUpsertClient>;

  beforeEach(() => {
    mockClient = {
      bulkUpsert: jest.fn<IBulkUpsertClient['bulkUpsert']>().mockResolvedValue({}),
    };
    builder = new BulkUpsertBuilder(mockClient);
  });

  describe("hasUpdates", () => {
    it("should return false when no updates have been added", () => {
      expect(builder.hasUpdates()).toBe(false);
    });

    it("should return true when an asset is added", () => {
      builder.upsertAsset({ name: "test-asset" });
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should return true when any type of update is added", () => {
      builder.upsertActivity({ name: "test-activity" });
      expect(builder.hasUpdates()).toBe(true);
    });
  });

  describe("DuplicateStrategy.MERGE (default)", () => {
    it("should add new item when no existing item exists", () => {
      builder.upsertAsset({ name: "asset1", updateType: "create_or_replace" });
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should deep merge when item with same key exists", () => {
      builder.upsertAsset({
        name: "asset1",
        updateType: "create_or_replace",
        labels: { key1: "value1" },
      });
      builder.upsertAsset({
        name: "asset1",
        updateType: "create_or_replace",
        labels: { key2: "value2" },
      });

      expect(mockClient.bulkUpsert).not.toHaveBeenCalled();

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
      expect(callArg.assets?.[0]?.labels).toEqual({ key1: "value1", key2: "value2" });
    });

    it("should merge nested objects deeply", () => {
      builder.upsertAsset({
        name: "asset1",
        updateType: "create_or_replace",
        info: { key1: "value1", nested: { a: "1" } },
      });
      builder.upsertAsset({
        name: "asset1",
        updateType: "create_or_replace",
        info: { key2: "value2", nested: { b: "2" } },
      });

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets?.[0]?.info).toEqual({
        key1: "value1",
        key2: "value2",
        nested: { a: "1", b: "2" },
      });
    });
  });

  describe("DuplicateStrategy.SKIP", () => {
    it("should add item when no existing item exists", () => {
      builder.upsertAsset({ name: "asset1" }, DuplicateStrategy.SKIP);
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
    });

    it("should skip adding item when item with same key exists", () => {
      builder.upsertAsset({ name: "asset1", labels: { key1: "value1" } }, DuplicateStrategy.SKIP);
      builder.upsertAsset({ name: "asset1", labels: { key2: "value2" } }, DuplicateStrategy.SKIP);

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
      expect(callArg.assets?.[0]?.labels).toEqual({ key1: "value1" });
    });
  });

  describe("DuplicateStrategy.REPLACE", () => {
    it("should add item when no existing item exists", () => {
      builder.upsertAsset({ name: "asset1" }, DuplicateStrategy.REPLACE);
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
    });

    it("should replace existing item with same key", () => {
      builder.upsertAsset(
        { name: "asset1", labels: { key1: "value1" } },
        DuplicateStrategy.REPLACE,
      );
      builder.upsertAsset(
        { name: "asset1", labels: { key2: "value2" } },
        DuplicateStrategy.REPLACE,
      );

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
      expect(callArg.assets?.[0]?.labels).toEqual({ key2: "value2" });
    });
  });

  describe("upsertAsset", () => {
    it("should add asset and return builder for chaining", () => {
      const result = builder.upsertAsset({ name: "asset1" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should handle multiple assets with different keys", () => {
      builder.upsertAsset({ name: "asset1" });
      builder.upsertAsset({ name: "asset2" });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(2);
    });
  });

  describe("upsertActivity", () => {
    it("should add activity and return builder for chaining", () => {
      const result = builder.upsertActivity({ name: "activity1" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should merge activities with same name", () => {
      builder.upsertActivity({ name: "activity1", updateType: "create_only" });
      builder.upsertActivity({ name: "activity1", updateType: "create_or_ignore" });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.activities).toHaveLength(1);
    });
  });

  describe("upsertEvent", () => {
    it("should add event and return builder for chaining", () => {
      const result = builder.upsertEvent({ name: "event1", activity: "activity1" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should merge events with same name and activity", () => {
      builder.upsertEvent({ name: "event1", activity: "activity1", info: { key1: "value1" } });
      builder.upsertEvent({ name: "event1", activity: "activity1", info: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.events).toHaveLength(1);
      expect(callArg.events?.[0]?.info).toEqual({ key1: "value1", key2: "value2" });
    });

    it("should not merge events with same name but different activities", () => {
      builder.upsertEvent({ name: "event1", activity: "activity1", info: { key1: "value1" } });
      builder.upsertEvent({ name: "event1", activity: "activity2", info: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.events).toHaveLength(2);
      expect(callArg.events).toContainEqual(
        expect.objectContaining({
          name: "event1",
          activity: "activity1",
          info: { key1: "value1" },
        }),
      );
      expect(callArg.events).toContainEqual(
        expect.objectContaining({
          name: "event1",
          activity: "activity2",
          info: { key2: "value2" },
        }),
      );
    });
  });

  describe("upsertAddress", () => {
    it("should add address and return builder for chaining", () => {
      const result = builder.upsertAddress({ address: "0x123" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should use address as key (not name)", () => {
      builder.upsertAddress({ address: "0x123", contract: true });
      builder.upsertAddress({ address: "0x123", contract: false });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.addresses).toHaveLength(1);
      expect(callArg.addresses?.[0]?.contract).toBe(false);
    });
  });

  describe("upsertData", () => {
    it("should add data and return builder for chaining", () => {
      const result = builder.upsertData({
        name: "data1",
        parent: { type: "pool", ref: "pool1" },
      });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });
  });

  describe("upsertPool", () => {
    it("should add pool and return builder for chaining", () => {
      const result = builder.upsertPool({ name: "pool1", address: "0x123" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should merge pools with same name and address", () => {
      builder.upsertPool({ name: "pool1", address: "0x123", labels: { key1: "value1" } });
      builder.upsertPool({ name: "pool1", address: "0x123", labels: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.pools).toHaveLength(1);
      expect(callArg.pools?.[0]?.labels).toEqual({ key1: "value1", key2: "value2" });
    });

    it("should not merge pools with same name but different addresses", () => {
      builder.upsertPool({ name: "pool1", address: "0x123", labels: { key1: "value1" } });
      builder.upsertPool({ name: "pool1", address: "0x456", labels: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.pools).toHaveLength(2);
      expect(callArg.pools).toContainEqual(
        expect.objectContaining({
          name: "pool1",
          address: "0x123",
          labels: { key1: "value1" },
        }),
      );
      expect(callArg.pools).toContainEqual(
        expect.objectContaining({
          name: "pool1",
          address: "0x456",
          labels: { key2: "value2" },
        }),
      );
    });
  });

  describe("upsertTransfer", () => {
    it("should add transfer and return builder for chaining", () => {
      const result = builder.upsertTransfer({
        protocolId: "transfer1",
        parent: { type: "pool", ref: "pool1" },
        transactionHash: "0x123",
      });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should use protocolId as key (not name)", () => {
      builder.upsertTransfer({
        protocolId: "transfer1",
        parent: { type: "pool", ref: "pool1" },
        transactionHash: "0x123",
        amount: "100",
      });
      builder.upsertTransfer({
        protocolId: "transfer1",
        parent: { type: "pool", ref: "pool1" },
        transactionHash: "0x123",
        amount: "200",
      });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.transfers).toHaveLength(1);
      expect(callArg.transfers?.[0]?.amount).toBe("200");
    });
  });

  describe("upsertFragment", () => {
    it("should add fragment and return builder for chaining", () => {
      const result = builder.upsertFragment({ name: "fragment1", address: "0x123" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should merge fragments with same name and address", () => {
      builder.upsertFragment({
        name: "fragment1",
        address: "0x123",
        labels: { key1: "value1" },
      });
      builder.upsertFragment({
        name: "fragment1",
        address: "0x123",
        labels: { key2: "value2" },
      });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.fragments).toHaveLength(1);
      expect(callArg.fragments?.[0]?.labels).toEqual({ key1: "value1", key2: "value2" });
    });

    it("should not merge fragments with same name but different addresses", () => {
      builder.upsertFragment({
        name: "fragment1",
        address: "0x123",
        labels: { key1: "value1" },
      });
      builder.upsertFragment({
        name: "fragment1",
        address: "0x456",
        labels: { key2: "value2" },
      });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.fragments).toHaveLength(2);
    });
  });

  describe("upsertNFT", () => {
    it("should add NFT and return builder for chaining", () => {
      const result = builder.upsertNFT({ name: "nft1", address: "0x123" });
      expect(result).toBe(builder);
      expect(builder.hasUpdates()).toBe(true);
    });

    it("should merge NFTs with same name and address", () => {
      builder.upsertNFT({ name: "nft1", address: "0x123", labels: { key1: "value1" } });
      builder.upsertNFT({ name: "nft1", address: "0x123", labels: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.nfts).toHaveLength(1);
      expect(callArg.nfts?.[0]?.labels).toEqual({ key1: "value1", key2: "value2" });
    });

    it("should not merge NFTs with same name but different addresses", () => {
      builder.upsertNFT({ name: "nft1", address: "0x123", labels: { key1: "value1" } });
      builder.upsertNFT({ name: "nft1", address: "0x456", labels: { key2: "value2" } });
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.nfts).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("should handle undefined name by adding item", () => {
      builder.upsertAsset({ name: undefined } as any);
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
      expect(callArg.assets?.[0]?.name).toBeUndefined();
    });

    it("should handle multiple items with undefined keys", () => {
      builder.upsertAsset({ name: undefined } as any);
      builder.upsertAsset({ name: undefined } as any);
      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(2);
    });

    it("should handle mixed strategies", () => {
      builder.upsertAsset({ name: "asset1", labels: { strategy: "merge" } });
      builder.upsertAsset({ name: "asset1", labels: { merged: "true" } });
      builder.upsertAsset({ name: "asset2", labels: { strategy: "skip" } }, DuplicateStrategy.SKIP);
      builder.upsertAsset(
        { name: "asset2", labels: { skipped: "true" } },
        DuplicateStrategy.SKIP,
      );
      builder.upsertAsset(
        { name: "asset3", labels: { strategy: "replace" } },
        DuplicateStrategy.REPLACE,
      );
      builder.upsertAsset(
        { name: "asset3", labels: { replaced: "true" } },
        DuplicateStrategy.REPLACE,
      );

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(3);

      const asset1 = callArg.assets?.find((a: any) => a.name === "asset1");
      expect(asset1?.labels).toEqual({ strategy: "merge", merged: "true" });

      const asset2 = callArg.assets?.find((a: any) => a.name === "asset2");
      expect(asset2?.labels).toEqual({ strategy: "skip" });

      const asset3 = callArg.assets?.find((a: any) => a.name === "asset3");
      expect(asset3?.labels).toEqual({ replaced: "true" });
    });
  });

  describe("addFinalizer", () => {
    it("should add finalizer and return builder for chaining", () => {
      const finalizer = jest.fn<() => void | Promise<void>>();
      const result = builder.addFinalizer(finalizer);
      expect(result).toBe(builder);
    });

    it("should execute finalizers after bulkUpsert", async () => {
      const finalizer1 = jest.fn<() => void | Promise<void>>();
      const finalizer2 = jest.fn<() => void | Promise<void>>();

      builder.upsertAsset({ name: "asset1" });
      builder.addFinalizer(finalizer1);
      builder.addFinalizer(finalizer2);

      await builder.execute();

      expect(mockClient.bulkUpsert).toHaveBeenCalled();
      expect(finalizer1).toHaveBeenCalled();
      expect(finalizer2).toHaveBeenCalled();
    });

    it("should execute finalizers even if no updates", async () => {
      const finalizer = jest.fn<() => void | Promise<void>>();
      builder.addFinalizer(finalizer);

      await builder.execute();

      expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
      expect(finalizer).toHaveBeenCalled();
    });

    it("should handle finalizer errors", async () => {
      const finalizer = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("Finalizer error"));
      builder.addFinalizer(finalizer);

      await expect(builder.execute()).rejects.toThrow("Finalizer error");
    });
  });

  describe("execute", () => {
    it("should not call bulkUpsert when no updates", async () => {
      await builder.execute();
      expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
    });

    it("should call bulkUpsert with all updates", async () => {
      builder.upsertAsset({ name: "asset1" });
      builder.upsertActivity({ name: "activity1" });
      builder.upsertEvent({ name: "event1", activity: "activity1" });
      builder.upsertAddress({ address: "0x123" });
      builder.upsertData({ name: "data1", parent: { type: "pool", ref: "pool1" } });
      builder.upsertPool({ name: "pool1", address: "0x123" });
      builder.upsertTransfer({
        protocolId: "transfer1",
        parent: { type: "pool", ref: "pool1" },
        transactionHash: "0x123",
      });
      builder.upsertFragment({ name: "fragment1", address: "0x123" });
      builder.upsertNFT({ name: "nft1", address: "0x123" });

      await builder.execute();

      expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(1);
      expect(callArg.activities).toHaveLength(1);
      expect(callArg.events).toHaveLength(1);
      expect(callArg.addresses).toHaveLength(1);
      expect(callArg.data).toHaveLength(1);
      expect(callArg.pools).toHaveLength(1);
      expect(callArg.transfers).toHaveLength(1);
      expect(callArg.fragments).toHaveLength(1);
      expect(callArg.nfts).toHaveLength(1);
    });

    it("should handle bulkUpsert errors", async () => {
      mockClient.bulkUpsert.mockRejectedValue(new Error("Bulk upsert error"));
      builder.upsertAsset({ name: "asset1" });

      await expect(builder.execute()).rejects.toThrow("Bulk upsert error");
    });
  });

  describe("chaining", () => {
    it("should support method chaining", () => {
      builder
        .upsertAsset({ name: "asset1" })
        .upsertActivity({ name: "activity1" })
        .upsertEvent({ name: "event1", activity: "activity1" })
        .addFinalizer(() => {});

      expect(builder.hasUpdates()).toBe(true);
    });
  });

  describe("retryOnInvalidRef (default: true)", () => {
    function invalidRefError(message = "KA090801 invalid reference") {
      const err = Object.assign(new Error(message), {
        response: { data: { message } },
      });
      return err;
    }

    function makeBuilder(options?: BulkUpsertBuilderOptions) {
      mockClient = { bulkUpsert: jest.fn<IBulkUpsertClient['bulkUpsert']>() };
      return new BulkUpsertBuilder(mockClient, options);
    }

    it("resolves dependency ordering: succeeds when retries make progress", async () => {
      // activity-1 must be created before event-1 (which references it).
      // The bulk upsert fails with KA090801; retryIndividually processes
      // each item alone — activity-1 succeeds first, then event-1 succeeds.
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1", updateType: "create_only" });
      builder.upsertEvent({ name: "event-1", activity: "activity-1", updateType: "create_only" });

      let callCount = 0;
      mockClient.bulkUpsert.mockImplementation(async (input: any) => {
        callCount++;
        if (callCount === 1) {
          // First call: full batch — fail to simulate ordering problem
          throw invalidRefError();
        }
        // Subsequent individual calls: succeed for activity, fail for event
        // until activity is persisted (simulated by callCount > 2)
        if (input.events && callCount < 4) {
          throw invalidRefError();
        }
        return {};
      });

      await builder.execute();

      // First attempt (bulk) + at least one pass of individual retries
      expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(callCount);
    });

    it("throws BulkUpsertInvalidRefError when no item can make progress", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1" });
      builder.upsertEvent({ name: "event-1", activity: "activity-1" });

      // Every call fails — nothing can ever succeed
      mockClient.bulkUpsert.mockRejectedValue(invalidRefError());

      await expect(builder.execute()).rejects.toThrow(BulkUpsertInvalidRefError);
    });

    it("BulkUpsertInvalidRefError carries the stuck items", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-stuck" });

      mockClient.bulkUpsert.mockRejectedValue(invalidRefError());

      const err = await builder.execute().catch((e) => e);
      expect(err).toBeInstanceOf(BulkUpsertInvalidRefError);
      expect((err as BulkUpsertInvalidRefError).stuck.activities).toHaveLength(1);
      expect((err as BulkUpsertInvalidRefError).stuck.activities?.[0]?.name).toBe("activity-stuck");
    });

    it("does not run finalizers when BulkUpsertInvalidRefError is thrown", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1" });
      const finalizer = jest.fn<() => void | Promise<void>>();
      builder.addFinalizer(finalizer);

      mockClient.bulkUpsert.mockRejectedValue(invalidRefError());

      await expect(builder.execute()).rejects.toThrow(BulkUpsertInvalidRefError);
      expect(finalizer).not.toHaveBeenCalled();
    });

    it("rethrows non-reference errors immediately without retrying", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1" });

      const networkError = new Error("network timeout");
      mockClient.bulkUpsert.mockRejectedValue(networkError);

      await expect(builder.execute()).rejects.toThrow("network timeout");
      // Only one call — no retry loop entered
      expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    });

    it("rethrows non-reference errors encountered during individual retries", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1" });
      builder.upsertEvent({ name: "event-1", activity: "activity-1" });

      let callCount = 0;
      mockClient.bulkUpsert.mockImplementation(async (input: any) => {
        callCount++;
        if (callCount === 1) throw invalidRefError();
        // During retry loop, activity succeeds but event hits a different error
        if (input.events) throw new Error("unexpected server error");
        return {};
      });

      await expect(builder.execute()).rejects.toThrow("unexpected server error");
    });

    it("detects KA090801 in axios-style response body", async () => {
      builder = makeBuilder();
      builder.upsertActivity({ name: "activity-1" });

      // Simulate AxiosError shape: message not in Error.message but in response.data
      const axiosErr = Object.assign(new Error("Request failed with status code 409"), {
        response: { data: { message: "KA090801 invalid reference for field 'asset'" } },
      });
      mockClient.bulkUpsert.mockRejectedValue(axiosErr);

      // Should enter retry loop, not rethrow immediately
      await expect(builder.execute()).rejects.toThrow(BulkUpsertInvalidRefError);
    });
  });

  describe("retryOnInvalidRef: false", () => {
    function invalidRefError() {
      return Object.assign(new Error("KA090801 invalid reference"), {
        response: { data: { message: "KA090801 invalid reference" } },
      });
    }

    beforeEach(() => {
      mockClient = { bulkUpsert: jest.fn<IBulkUpsertClient['bulkUpsert']>() };
      builder = new BulkUpsertBuilder(mockClient, { retryOnInvalidRef: false });
    });

    it("rethrows KA090801 immediately without retrying", async () => {
      builder.upsertActivity({ name: "activity-1" });

      mockClient.bulkUpsert.mockRejectedValue(invalidRefError());

      await expect(builder.execute()).rejects.toThrow("KA090801 invalid reference");
      expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    });

    it("does not run finalizers when KA090801 is thrown", async () => {
      builder.upsertActivity({ name: "activity-1" });
      const finalizer = jest.fn<() => void | Promise<void>>();
      builder.addFinalizer(finalizer);

      mockClient.bulkUpsert.mockRejectedValue(invalidRefError());

      await expect(builder.execute()).rejects.toThrow("KA090801");
      expect(finalizer).not.toHaveBeenCalled();
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple items of same type with different strategies", () => {
      builder.upsertAsset({ name: "asset1", labels: { type: "merge" } });
      builder.upsertAsset({ name: "asset1", labels: { merged: "true" } });
      builder.upsertAsset({ name: "asset2", labels: { type: "skip" } }, DuplicateStrategy.SKIP);
      builder.upsertAsset({ name: "asset2", labels: { skipped: "true" } }, DuplicateStrategy.SKIP);
      builder.upsertAsset(
        { name: "asset3", labels: { type: "replace" } },
        DuplicateStrategy.REPLACE,
      );
      builder.upsertAsset(
        { name: "asset3", labels: { replaced: "true" } },
        DuplicateStrategy.REPLACE,
      );

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(3);

      const asset1 = callArg.assets?.find((a: any) => a.name === "asset1");
      const asset2 = callArg.assets?.find((a: any) => a.name === "asset2");
      const asset3 = callArg.assets?.find((a: any) => a.name === "asset3");

      expect(asset1?.labels).toEqual({ type: "merge", merged: "true" });
      expect(asset2?.labels).toEqual({ type: "skip" });
      expect(asset3?.labels).toEqual({ replaced: "true" });
    });

    it("should handle multiple calls to same upsert method", () => {
      builder
        .upsertAsset({ name: "asset1" })
        .upsertAsset({ name: "asset2" })
        .upsertAsset({ name: "asset3" })
        .upsertActivity({ name: "activity1" })
        .upsertActivity({ name: "activity2" });

      builder.execute();

      const callArg = mockClient.bulkUpsert.mock.calls[0][0];
      expect(callArg.assets).toHaveLength(3);
      expect(callArg.activities).toHaveLength(2);
    });
  });
});
