import deepmerge from "deepmerge";
import { AssetManagerClient } from "./asset-manager.js";
import {
  ActivityBulkInput,
  AddressBulkInput,
  AssetBulkInput,
  BulkUpsertInput,
  CollectionBulkInput,
  DataBulkInput,
  EventBulkInput,
  FragmentBulkInput,
  NFTBulkInput,
  PoolBulkInput,
  TransferBulkInput,
} from "./asset-manager.interfaces.js";

/**
 * We must ensure that each bulk update touches a given record at most once,
 * otherwise the bulk upsert will fail.
 * Therefore, each time an update is added to the bulk updater, the existing
 * accumulated updates must be scanned to remove duplicates, according to the
 * duplicate strategy.
 */
export enum DuplicateStrategy {
  MERGE = 0, // Deep merge with any previous update to the same item (default)
  SKIP = 1, // Only add this update if one doesn't already exist in the list
  REPLACE = 2, // Replace any previous update to the same item
}

/**
 * BulkUpsertBuilder is a helper class that allows you to build a bulk upsert request.
 * It ensures that each update touches a given record at most once.
 * It also allows you to add finalizers that will be executed after the bulk upsert is executed.
 */
export class BulkUpsertBuilder {
  private updates: BulkUpsertInput = {};
  private finalizers: (() => void | Promise<void>)[] = [];

  constructor(private client: AssetManagerClient) {}

  hasUpdates() {
    for (const val of Object.values(this.updates)) {
      if (val && val.length > 0) {
        return true;
      }
    }
    return false;
  }

  upsertAsset(asset: AssetBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.assets = this.upsertItem(this.updates.assets, asset, (a) => a.name, duplicates);
    return this;
  }

  upsertActivity(activity: ActivityBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.activities = this.upsertItem(
      this.updates.activities,
      activity,
      (a) => a.name,
      duplicates,
    );
    return this;
  }

  upsertCollection(collection: CollectionBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.collections = this.upsertItem(
      this.updates.collections,
      collection,
      (a) => a.name,
      duplicates,
    );
    return this;
  }

  upsertEvent(event: EventBulkInput, duplicates?: DuplicateStrategy) {
    // Events are scoped by both name and activity
    this.updates.events = this.upsertItem(
      this.updates.events,
      event,
      (a) => (a.name && a.activity ? `${a.activity}:${a.name}` : a.name),
      duplicates,
    );
    return this;
  }

  upsertAddress(address: AddressBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.addresses = this.upsertItem(
      this.updates.addresses,
      address,
      (a) => a.address,
      duplicates,
    );
    return this;
  }

  upsertData(data: DataBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.data = this.upsertItem(this.updates.data, data, (a) => a.name, duplicates);
    return this;
  }

  upsertPool(pool: PoolBulkInput, duplicates?: DuplicateStrategy) {
    // Pools are scoped by both name and address
    this.updates.pools = this.upsertItem(
      this.updates.pools,
      pool,
      (a) => (a.name && a.address ? `${a.address}:${a.name}` : a.name),
      duplicates,
    );
    return this;
  }

  upsertTransfer(transfer: TransferBulkInput, duplicates?: DuplicateStrategy) {
    this.updates.transfers = this.upsertItem(
      this.updates.transfers,
      transfer,
      (a) => a.protocolId,
      duplicates,
    );
    return this;
  }

  upsertFragment(fragment: FragmentBulkInput, duplicates?: DuplicateStrategy) {
    // Fragments are scoped by both name and address
    this.updates.fragments = this.upsertItem(
      this.updates.fragments,
      fragment,
      (a) => (a.name && a.address ? `${a.address}:${a.name}` : a.name),
      duplicates,
    );
    return this;
  }

  upsertNFT(nft: NFTBulkInput, duplicates?: DuplicateStrategy) {
    // NFTs are scoped by both name and address
    this.updates.nfts = this.upsertItem(
      this.updates.nfts,
      nft,
      (a) => (a.name && a.address ? `${a.address}:${a.name}` : a.name),
      duplicates,
    );
    return this;
  }

  private upsertItem<T>(
    items: T[] | undefined,
    newItem: T,
    getKey: (item: T) => string | undefined,
    duplicates?: DuplicateStrategy,
  ): T[] {
    const itemKey = getKey(newItem);
    if (items === undefined || itemKey === undefined) {
      return this.append(items, newItem);
    }

    switch (duplicates) {
      case DuplicateStrategy.SKIP: {
        if (items.find((a) => getKey(a) === itemKey) === undefined) {
          return this.append(items, newItem);
        }
        return items;
      }

      case DuplicateStrategy.REPLACE: {
        const filtered = items.filter((a) => getKey(a) !== itemKey) ?? [];
        return this.append(filtered, newItem);
      }

      default: {
        const existingIndex = items.findIndex((a) => getKey(a) === itemKey);
        if (existingIndex >= 0) {
          items[existingIndex] = deepmerge(items[existingIndex] as object, newItem as object) as T;
          return items;
        }
        return this.append(items, newItem);
      }
    }
  }

  private append<T>(oldItems: T[] | undefined, newItem: T) {
    if (oldItems === undefined) {
      return [newItem];
    } else {
      oldItems.push(newItem);
      return oldItems;
    }
  }

  addFinalizer(finalizer: () => void | Promise<void>) {
    this.finalizers.push(finalizer);
    return this;
  }

  async execute() {
    if (this.hasUpdates()) {
      await this.client.bulkUpsert(this.updates);
    }

    if (this.finalizers.length > 0) {
      await Promise.all(this.finalizers.map((f) => Promise.resolve(f())));
    }
  }
}
