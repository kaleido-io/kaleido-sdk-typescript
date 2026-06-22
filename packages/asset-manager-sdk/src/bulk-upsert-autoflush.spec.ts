import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BulkUpsertAutoFlush } from "./bulk-upsert-autoflush.js";
import { BulkUpsertBuilder, DuplicateStrategy } from "./bulk-upsert-builder.js";

describe("BulkUpsertAutoFlush", () => {
  let mockBuilder: jest.Mocked<BulkUpsertBuilder>;
  let autoFlush: BulkUpsertAutoFlush;
  const FLUSH_AT = 3;

  beforeEach(() => {
    mockBuilder = {
      upsertAsset: jest.fn().mockReturnThis(),
      upsertActivity: jest.fn().mockReturnThis(),
      upsertCollection: jest.fn().mockReturnThis(),
      upsertEvent: jest.fn().mockReturnThis(),
      upsertAddress: jest.fn().mockReturnThis(),
      upsertData: jest.fn().mockReturnThis(),
      upsertPool: jest.fn().mockReturnThis(),
      upsertTransfer: jest.fn().mockReturnThis(),
      upsertFragment: jest.fn().mockReturnThis(),
      upsertNFT: jest.fn().mockReturnThis(),
      addFinalizer: jest.fn().mockReturnThis(),
      getCount: jest.fn<() => number>().mockReturnValue(0),
      execute: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      hasUpdates: jest.fn<() => boolean>().mockReturnValue(false),
    } as unknown as jest.Mocked<BulkUpsertBuilder>;

    autoFlush = new BulkUpsertAutoFlush(mockBuilder, FLUSH_AT);
  });

  describe("delegation", () => {
    it("upsertAsset forwards args including DuplicateStrategy", async () => {
      const asset = { name: "asset1" };
      await autoFlush.upsertAsset(asset, DuplicateStrategy.REPLACE);
      expect(mockBuilder.upsertAsset).toHaveBeenCalledWith(asset, DuplicateStrategy.REPLACE);
    });

    it("upsertActivity", async () => {
      const activity = { name: "activity1" };
      await autoFlush.upsertActivity(activity);
      expect(mockBuilder.upsertActivity).toHaveBeenCalledWith(activity, undefined);
    });

    it("upsertCollection", async () => {
      const collection = { name: "collection1" };
      await autoFlush.upsertCollection(collection);
      expect(mockBuilder.upsertCollection).toHaveBeenCalledWith(collection, undefined);
    });

    it("upsertEvent", async () => {
      const event = { name: "event1", activity: "activity1" };
      await autoFlush.upsertEvent(event);
      expect(mockBuilder.upsertEvent).toHaveBeenCalledWith(event, undefined);
    });

    it("upsertAddress", async () => {
      const address = { address: "0x123" };
      await autoFlush.upsertAddress(address);
      expect(mockBuilder.upsertAddress).toHaveBeenCalledWith(address, undefined);
    });

    it("upsertData", async () => {
      const data = { name: "data1", parent: { type: "pool" as const, ref: "pool1" } };
      await autoFlush.upsertData(data);
      expect(mockBuilder.upsertData).toHaveBeenCalledWith(data, undefined);
    });

    it("upsertPool", async () => {
      const pool = { name: "pool1", address: "0x123" };
      await autoFlush.upsertPool(pool);
      expect(mockBuilder.upsertPool).toHaveBeenCalledWith(pool, undefined);
    });

    it("upsertTransfer", async () => {
      const transfer = { protocolId: "t1", parent: { type: "pool" as const, ref: "pool1" }, transactionHash: "0xabc" };
      await autoFlush.upsertTransfer(transfer);
      expect(mockBuilder.upsertTransfer).toHaveBeenCalledWith(transfer, undefined);
    });

    it("upsertFragment", async () => {
      const fragment = { name: "fragment1", address: "0x123" };
      await autoFlush.upsertFragment(fragment);
      expect(mockBuilder.upsertFragment).toHaveBeenCalledWith(fragment, undefined);
    });

    it("upsertNFT", async () => {
      const nft = { name: "nft1", address: "0x123" };
      await autoFlush.upsertNFT(nft);
      expect(mockBuilder.upsertNFT).toHaveBeenCalledWith(nft, undefined);
    });

    it("execute delegates to builder", async () => {
      await autoFlush.execute();
      expect(mockBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it("addFinalizer delegates to builder and returns this", () => {
      const finalizer = jest.fn<() => void>();
      const result = autoFlush.addFinalizer(finalizer);
      expect(mockBuilder.addFinalizer).toHaveBeenCalledWith(finalizer);
      expect(result).toBe(autoFlush);
    });
  });

  describe("auto-flush", () => {
    it("does not flush when count is below threshold", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT - 1);
      await autoFlush.upsertAsset({ name: "asset1" });
      expect(mockBuilder.execute).not.toHaveBeenCalled();
    });

    it("flushes when count reaches threshold", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT);
      await autoFlush.upsertAsset({ name: "asset1" });
      expect(mockBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it("flushes when count exceeds threshold", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT + 2);
      await autoFlush.upsertAsset({ name: "asset1" });
      expect(mockBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it("does not flush on explicit execute()", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT - 1);
      await autoFlush.execute();
      // execute() calls builder.execute() directly, not via flushIfNeeded
      expect(mockBuilder.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTotalCount", () => {
    it("returns builder count when no flush has occurred", () => {
      mockBuilder.getCount.mockReturnValue(2);
      expect(autoFlush.getTotalCount()).toBe(2);
    });

    it("accumulates count across flushes", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT);
      await autoFlush.upsertAsset({ name: "asset1" });

      // Simulate builder reset after execute
      mockBuilder.getCount.mockReturnValue(1);
      expect(autoFlush.getTotalCount()).toBe(FLUSH_AT + 1);
    });

    it("accumulates across multiple flushes", async () => {
      mockBuilder.getCount.mockReturnValue(FLUSH_AT);
      await autoFlush.upsertAsset({ name: "a1" });
      await autoFlush.upsertAsset({ name: "a2" });

      mockBuilder.getCount.mockReturnValue(0);
      expect(autoFlush.getTotalCount()).toBe(FLUSH_AT * 2);
    });
  });
});
