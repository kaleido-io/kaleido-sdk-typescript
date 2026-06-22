import deepmerge from "deepmerge";
import { AxiosRequestConfig } from "axios";
import {
  ActivityBulkInput,
  AddressBulkInput,
  AssetBulkInput,
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  CollectionBulkInput,
  DataBulkInput,
  EventBulkInput,
  FragmentBulkInput,
  NFTBulkInput,
  PoolBulkInput,
  TransferBulkInput,
} from "./asset-manager.interfaces.js";
import { BulkUpsertAutoFlush } from "./bulk-upsert-autoflush.js";
import { RequestContext } from "@kaleido-io/workflow-engine-sdk";

export interface IBulkUpsertClient {
  bulkUpsert(input: BulkUpsertInput, options?: AxiosRequestConfig): Promise<unknown>;
}

export interface IBulkQueryClient {
  bulkQuery(input: BulkQueryInput, options?: AxiosRequestConfig): Promise<BulkQueryOutput>;
}

export interface IDataModelClient extends IBulkUpsertClient, IBulkQueryClient {};

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
 * Options for configuring BulkUpsertBuilder behaviour at construction time.
 */
export interface BulkUpsertBuilderOptions {

  /**
   * Primary use case is to use this within the indexer, where we are working
   * within the request context of an active workflow engine request.
   */
  reqContext?: RequestContext;

  /**
   * When `true` (default), if a bulk upsert fails with an invalid-reference
   * error (KA090801), the builder retries each item individually in repeated
   * passes to resolve dependency ordering within the batch. If a full pass
   * produces no progress, {@link BulkUpsertInvalidRefError} is thrown.
   *
   * Set to `false` if you are managing item ordering yourself and want a fast
   * throw on any invalid-reference error rather than the retry loop.
   */
  retryOnInvalidRef?: boolean;
}

/**
 * Thrown by {@link BulkUpsertBuilder.execute} when `retryOnInvalidRef` is
 * enabled and individual retries reach a state where no item can make
 * progress — i.e. every remaining item fails with KA090801 in a full pass.
 *
 * The `stuck` property carries the items that could not be persisted so the
 * caller can log or inspect them.
 */
export class BulkUpsertInvalidRefError extends Error {
  constructor(public readonly stuck: BulkUpsertInput) {
    super("Bulk upsert failed: unresolvable invalid reference(s)");
    this.name = "BulkUpsertInvalidRefError";
  }
}

/**
 * BulkUpsertBuilder accumulates data-model updates and executes them as a
 * single bulk upsert, ensuring each record is touched at most once per call.
 *
 * Finalizers registered via {@link addFinalizer} run after a successful
 * upsert. They are **not** called if the upsert throws.
 */
export class BulkUpsertBuilder {
  private updates: BulkUpsertInput = {};
  private finalizers: (() => void | Promise<void>)[] = [];
  private count: number = 0;
  private reqContext: RequestContext | undefined;

  constructor(
    private client: IBulkUpsertClient,
    private options: BulkUpsertBuilderOptions = {},
  ) {
    this.reqContext= options?.reqContext;
  }

  autoFlush(flushAt: number): BulkUpsertAutoFlush {
    return new BulkUpsertAutoFlush(this, flushAt);
  }

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
    this.count++;
    if (oldItems === undefined) {
      return [newItem];
    } else {
      oldItems.push(newItem);
      return oldItems;
    }
  }

  getCount(): number {
    return this.count;
  }

  addFinalizer(finalizer: () => void | Promise<void>) {
    this.finalizers.push(finalizer);
    return this;
  }

  /**
   * Executes the accumulated bulk upsert, then runs all registered finalizers.
   *
   * Finalizers run only when the upsert succeeds. If the upsert throws for
   * any reason, finalizers are skipped and the error propagates to the caller.
   *
   * When `retryOnInvalidRef` is `true` (default) and the bulk upsert fails
   * with KA090801, items are retried individually in repeated passes. If a
   * complete pass makes no progress, {@link BulkUpsertInvalidRefError} is
   * thrown carrying the stuck items.
   *
   * When `retryOnInvalidRef` is `false`, any KA090801 error is rethrown
   * immediately without retrying.
   */
  async execute(): Promise<void> {
    if (this.hasUpdates()) {
      try {
        await this.client.bulkUpsert(this.updates, { signal: this.reqContext?.signal });
      } catch (err) {
        if ((this.options.retryOnInvalidRef ?? true) && isInvalidRefError(err)) {
          await this.retryIndividually();
        } else {
          throw err;
        }
      }
    }

    if (this.finalizers.length > 0) {
      await Promise.all(this.finalizers.map((f) => Promise.resolve(f())));
    }
    
    // Reset the count and updates
    this.count = 0;
    this.updates = {};
  }
  
  private async retryIndividually(): Promise<void> {
    while (true) {
      let anySucceeded = false;
      let anyFailed = false;
      for (const key of Object.keys(this.updates) as (keyof BulkUpsertInput)[]) {
        const items = this.updates[key];
        if (!Array.isArray(items)) continue;
        for (let i = 0; i < items.length; i++) {
          try {
            await this.client.bulkUpsert({ [key]: [items[i]] }, { signal: this.reqContext?.signal });
            items.splice(i--, 1);
            anySucceeded = true;
          } catch (err) {
            if (isInvalidRefError(err)) {
              anyFailed = true;
            } else {
              throw err;
            }
          }
        }
      }
      if (!anyFailed) break;
      if (!anySucceeded) throw new BulkUpsertInvalidRefError(this.updates);
    }
  }
}

/**
 * Returns true if the error is an invalid-reference error from the Asset
 * Manager (error code KA090801). Handles both AxiosError response bodies
 * and plain Error messages.
 */
function isInvalidRefError(err: unknown): boolean {
  if (err instanceof Error && err.message.includes("KA090801")) return true;
  const axiosErr = err as { response?: { data?: unknown } };
  if (axiosErr?.response?.data != null) {
    const body =
      typeof axiosErr.response.data === "string"
        ? axiosErr.response.data
        : JSON.stringify(axiosErr.response.data);
    return body.includes("KA090801");
  }
  return false;
}
