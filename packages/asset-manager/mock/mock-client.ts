// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { AssetManagerClient } from "../src/asset-manager.js";
import type {
  Activity,
  ActivityEvent,
  ActivityInput,
  Address,
  AddressInput,
  Asset,
  AssetInput,
  Balance,
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  BulkUpsertOutput,
  Collection,
  Data,
  DataInput,
  DataModelListener,
  DataModelListenerInput,
  DataModelSubscription,
  DataModelSubscriptionInput,
  EventInput,
  FireFlyListener,
  FireFlyListenerInput,
  Fragment,
  FragmentInput,
  ItemsResult,
  NFT,
  NFTInput,
  Pool,
  PoolInput,
  SubscriptionResetRequest,
  Transfer,
  TransferInput,
} from "../src/asset-manager.interfaces.js";
import { AssetManagerStore, MockAssetManagerStoreOptions } from "./store.js";
import { MsgItemNotFound, MsgNotImplementedInMock } from "./errors.js";
import { EventBatchDelivery, SubscriptionCallback } from "./events.js";
import { balanceKey } from "./balances.js";

export interface MockAssetManagerClientOptions extends MockAssetManagerStoreOptions {
  /** Inject an existing store (useful for sharing state across
   *  multiple mock clients in a test). */
  store?: AssetManagerStore;
}

/**
 * In-memory drop-in for `AssetManagerClient`.
 *
 * Construct one per test (or share via the `store` option). Every
 * SDK method that has a server-faithful implementation is overridden
 * to route through the store; methods in the v1 "out of scope" set
 * throw with code MOCK000.
 *
 * The constructor calls `super({...})` with a placeholder URL — the
 * inherited HTTP transport is never invoked because every method is
 * overridden. If a test calls a non-overridden method, the throw
 * surfaces clearly via `MsgNotImplementedInMock`.
 */
export class MockAssetManagerClient extends AssetManagerClient {
  readonly store: AssetManagerStore;

  constructor(opts: MockAssetManagerClientOptions = {}) {
    super({ transport: "http", url: "mock://asset-manager" });
    this.store = opts.store ?? new AssetManagerStore(opts);
  }

  // ─── Status ────────────────────────────────────────────────────
  override getStatus(): Promise<{ status: string }> {
    return Promise.resolve({ status: "ok" });
  }

  // ─── Assets ────────────────────────────────────────────────────
  override getAssets(): Promise<ItemsResult<Asset>> {
    return Promise.resolve(asItems(this.store.assets));
  }
  override getAsset(nameOrId: string): Promise<Asset | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Asset>("assets", nameOrId),
    );
  }
  override createAsset(asset: AssetInput & { labels?: any }): Promise<Asset> {
    this.store.bulkUpsert({
      assets: [{ ...asset, updateType: "create_only" } as any],
    });
    const created = this.store.findByIdentity<Asset>("assets", asset.name!)!;
    return Promise.resolve(created);
  }
  override updateAsset(
    nameOrId: string,
    patch: Partial<AssetInput>,
  ): Promise<Asset> {
    this.store.bulkUpsert({
      assets: [{ name: nameOrId, ...patch, updateType: "update_only" } as any],
    });
    const updated = this.store.findByIdentity<Asset>("assets", nameOrId);
    if (!updated) throw MsgItemNotFound("assets", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteAsset(nameOrId: string): Promise<void> {
    this.store.delete("assets", nameOrId);
  }

  // ─── Addresses ─────────────────────────────────────────────────
  override getAddresses(): Promise<ItemsResult<Address>> {
    return Promise.resolve(asItems(this.store.addresses));
  }
  override getAddress(address: string): Promise<Address | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Address>("addresses", address),
    );
  }
  override createAddress(
    input: AddressInput & { labels?: any },
  ): Promise<Address> {
    this.store.bulkUpsert({
      addresses: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Address>("addresses", input.address!)!,
    );
  }
  override updateAddress(
    addr: string,
    patch: Partial<AddressInput>,
  ): Promise<Address> {
    this.store.bulkUpsert({
      addresses: [
        { address: addr, ...patch, updateType: "update_only" } as any,
      ],
    });
    const updated = this.store.findByIdentity<Address>("addresses", addr);
    if (!updated) throw MsgItemNotFound("addresses", addr);
    return Promise.resolve(updated);
  }
  override async deleteAddress(address: string): Promise<void> {
    this.store.delete("addresses", address);
  }

  // ─── Pools ─────────────────────────────────────────────────────
  override getPools(): Promise<ItemsResult<Pool>> {
    return Promise.resolve(asItems(this.store.pools));
  }
  override getPool(nameOrId: string): Promise<Pool | undefined> {
    return Promise.resolve(this.store.findByIdentity<Pool>("pools", nameOrId));
  }
  override createPool(pool: PoolInput & { labels?: any }): Promise<Pool> {
    this.store.bulkUpsert({
      pools: [{ ...pool, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Pool>("pools", pool.name!)!,
    );
  }
  override updatePool(
    nameOrId: string,
    patch: Partial<PoolInput>,
  ): Promise<Pool> {
    this.store.bulkUpsert({
      pools: [{ name: nameOrId, ...patch, updateType: "update_only" } as any],
    });
    const updated = this.store.findByIdentity<Pool>("pools", nameOrId);
    if (!updated) throw MsgItemNotFound("pools", nameOrId);
    return Promise.resolve(updated);
  }
  override async deletePool(nameOrId: string): Promise<void> {
    this.store.delete("pools", nameOrId);
  }

  // ─── NFTs ──────────────────────────────────────────────────────
  override getNFTs(): Promise<ItemsResult<NFT>> {
    return Promise.resolve(asItems(this.store.nfts));
  }
  override getNFT(nameOrId: string): Promise<NFT | undefined> {
    return Promise.resolve(this.store.findByIdentity<NFT>("nfts", nameOrId));
  }
  override createNFT(nft: NFTInput & { labels?: any }): Promise<NFT> {
    this.store.bulkUpsert({
      nfts: [{ ...nft, updateType: "create_only" } as any],
    });
    return Promise.resolve(this.store.findByIdentity<NFT>("nfts", nft.name!)!);
  }
  override updateNFT(nameOrId: string, patch: Partial<NFTInput>): Promise<NFT> {
    this.store.bulkUpsert({
      nfts: [{ name: nameOrId, ...patch, updateType: "update_only" } as any],
    });
    const updated = this.store.findByIdentity<NFT>("nfts", nameOrId);
    if (!updated) throw MsgItemNotFound("nfts", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteNFT(nameOrId: string): Promise<void> {
    this.store.delete("nfts", nameOrId);
  }

  // ─── Fragments ─────────────────────────────────────────────────
  override getFragments(): Promise<ItemsResult<Fragment>> {
    return Promise.resolve(asItems(this.store.fragments));
  }
  override getFragment(nameOrId: string): Promise<Fragment | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Fragment>("fragments", nameOrId),
    );
  }
  override createFragment(
    frag: FragmentInput & { labels?: any },
  ): Promise<Fragment> {
    this.store.bulkUpsert({
      fragments: [{ ...frag, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Fragment>("fragments", frag.name!)!,
    );
  }
  override updateFragment(
    nameOrId: string,
    patch: Partial<FragmentInput>,
  ): Promise<Fragment> {
    this.store.bulkUpsert({
      fragments: [
        { name: nameOrId, ...patch, updateType: "update_only" } as any,
      ],
    });
    const updated = this.store.findByIdentity<Fragment>("fragments", nameOrId);
    if (!updated) throw MsgItemNotFound("fragments", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteFragment(nameOrId: string): Promise<void> {
    this.store.delete("fragments", nameOrId);
  }

  // ─── Collections ───────────────────────────────────────────────
  override getCollections(): Promise<ItemsResult<Collection>> {
    return Promise.resolve(asItems(this.store.collections));
  }
  override getCollection(nameOrId: string): Promise<Collection | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Collection>("collections", nameOrId),
    );
  }
  override createCollection(input: {
    name?: string;
    displayName?: string;
    description?: string;
    labels?: any;
  }): Promise<Collection> {
    this.store.bulkUpsert({
      collections: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Collection>("collections", input.name!)!,
    );
  }
  override updateCollection(
    nameOrId: string,
    patch: { displayName?: string; description?: string },
  ): Promise<Collection> {
    this.store.bulkUpsert({
      collections: [
        { name: nameOrId, ...patch, updateType: "update_only" } as any,
      ],
    });
    const updated = this.store.findByIdentity<Collection>(
      "collections",
      nameOrId,
    );
    if (!updated) throw MsgItemNotFound("collections", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteCollection(nameOrId: string): Promise<void> {
    this.store.delete("collections", nameOrId);
  }

  // ─── Activities ────────────────────────────────────────────────
  override getActivities(): Promise<ItemsResult<Activity>> {
    return Promise.resolve(asItems(this.store.activities));
  }
  override getActivity(nameOrId: string): Promise<Activity | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Activity>("activities", nameOrId),
    );
  }
  override createActivity(
    input: ActivityInput & { labels?: any },
  ): Promise<Activity> {
    this.store.bulkUpsert({
      activities: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Activity>("activities", input.name!)!,
    );
  }
  override updateActivity(
    nameOrId: string,
    patch: Partial<ActivityInput>,
  ): Promise<Activity> {
    this.store.bulkUpsert({
      activities: [
        { name: nameOrId, ...patch, updateType: "update_only" } as any,
      ],
    });
    const updated = this.store.findByIdentity<Activity>("activities", nameOrId);
    if (!updated) throw MsgItemNotFound("activities", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteActivity(nameOrId: string): Promise<void> {
    this.store.delete("activities", nameOrId);
  }

  // ─── Data ──────────────────────────────────────────────────────
  override getData(): Promise<ItemsResult<Data>> {
    return Promise.resolve(asItems(this.store.data));
  }
  override getDataSingle(nameOrId: string): Promise<Data | undefined> {
    return Promise.resolve(this.store.findByIdentity<Data>("data", nameOrId));
  }
  override createData(input: DataInput & { labels?: any }): Promise<Data> {
    this.store.bulkUpsert({
      data: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Data>("data", input.name!)!,
    );
  }
  override updateData(
    nameOrId: string,
    patch: Partial<DataInput>,
  ): Promise<Data> {
    this.store.bulkUpsert({
      data: [{ name: nameOrId, ...patch, updateType: "update_only" } as any],
    });
    const updated = this.store.findByIdentity<Data>("data", nameOrId);
    if (!updated) throw MsgItemNotFound("data", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteData(nameOrId: string): Promise<void> {
    this.store.delete("data", nameOrId);
  }

  // ─── Events ────────────────────────────────────────────────────
  override getEvents(): Promise<ItemsResult<ActivityEvent>> {
    return Promise.resolve(asItems(this.store.events));
  }
  override getEvent(nameOrId: string): Promise<ActivityEvent | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<ActivityEvent>("events", nameOrId),
    );
  }
  override createEvent(
    input: EventInput & { labels?: any; activity?: string },
  ): Promise<ActivityEvent> {
    this.store.bulkUpsert({
      events: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<ActivityEvent>("events", input.name!)!,
    );
  }
  override updateEvent(
    nameOrId: string,
    patch: Partial<EventInput>,
  ): Promise<ActivityEvent> {
    this.store.bulkUpsert({
      events: [{ name: nameOrId, ...patch, updateType: "update_only" } as any],
    });
    const updated = this.store.findByIdentity<ActivityEvent>(
      "events",
      nameOrId,
    );
    if (!updated) throw MsgItemNotFound("events", nameOrId);
    return Promise.resolve(updated);
  }
  override async deleteEvent(nameOrId: string): Promise<void> {
    this.store.delete("events", nameOrId);
  }

  // ─── Transfers ─────────────────────────────────────────────────
  override getTransfers(): Promise<ItemsResult<Transfer>> {
    return Promise.resolve(asItems(this.store.transfers));
  }
  override getTransfer(idOrProtocolId: string): Promise<Transfer | undefined> {
    return Promise.resolve(
      this.store.findByIdentity<Transfer>("transfers", idOrProtocolId),
    );
  }
  override createTransfer(
    input: TransferInput & { labels?: any },
  ): Promise<Transfer> {
    this.store.bulkUpsert({
      transfers: [{ ...input, updateType: "create_only" } as any],
    });
    return Promise.resolve(
      this.store.findByIdentity<Transfer>("transfers", input.protocolId)!,
    );
  }
  override updateTransfer(
    idOrProtocolId: string,
    patch: Partial<TransferInput>,
  ): Promise<Transfer> {
    this.store.bulkUpsert({
      transfers: [
        {
          protocolId: idOrProtocolId,
          ...patch,
          updateType: "update_only",
        } as any,
      ],
    });
    const updated = this.store.findByIdentity<Transfer>(
      "transfers",
      idOrProtocolId,
    );
    if (!updated) throw MsgItemNotFound("transfers", idOrProtocolId);
    return Promise.resolve(updated);
  }
  override async deleteTransfer(id: string): Promise<void> {
    this.store.delete("transfers", id);
  }

  // ─── Balances ──────────────────────────────────────────────────
  override getBalances(): Promise<ItemsResult<Balance>> {
    return Promise.resolve(asItems(this.latestBalanceRows()));
  }
  override getBalance(_id: string): Promise<Balance | undefined> {
    // Balances don't really have a discrete "id" in the mock — pool id
    // / address pair is the natural key. Surface undefined for now.
    return Promise.resolve(undefined);
  }
  override getAddressBalances(address: string): Promise<ItemsResult<Balance>> {
    const rows = this.latestBalanceRows().filter(
      (b) => b.address?.toLowerCase() === address.toLowerCase(),
    );
    return Promise.resolve(asItems(rows));
  }
  override getAssetBalances(
    assetNameOrId: string,
  ): Promise<ItemsResult<Balance>> {
    const asset = this.store.findByIdentity<Asset>("assets", assetNameOrId);
    if (!asset) return Promise.resolve(asItems([] as Balance[]));
    const rows = this.latestBalanceRows().filter((b) => b.asset === asset.id);
    return Promise.resolve(asItems(rows));
  }
  override getPoolBalances(
    poolNameOrId: string,
  ): Promise<ItemsResult<Balance>> {
    const pool = this.store.findByIdentity<Pool>("pools", poolNameOrId);
    if (!pool) return Promise.resolve(asItems([] as Balance[]));
    const rows = this.latestBalanceRows().filter((b) => b.pool === pool.id);
    return Promise.resolve(asItems(rows));
  }

  private latestBalanceRows(): Balance[] {
    // Reconstruct from the store's balanceChanges: for each unique
    // (parent, address) take the most recent.
    const latest = new Map<string, Balance>();
    for (const bc of this.store.balanceChanges) {
      if (!bc.parent?.ref || !bc.address) continue;
      const key = balanceKey(bc.parent.ref, bc.address);
      latest.set(key, {
        id: bc.id,
        address: bc.address,
        asset: bc.asset,
        pool: bc.parent.type === "pool" ? bc.parent.ref : undefined,
        balanceAfter: bc.balanceAfter,
        updated: bc.updated,
      });
    }
    return [...latest.values()];
  }

  // ─── Bulk ──────────────────────────────────────────────────────
  override bulkQuery(input: BulkQueryInput): Promise<BulkQueryOutput> {
    return Promise.resolve(this.store.bulkQuery(input));
  }
  override bulkUpsert(input: BulkUpsertInput): Promise<BulkUpsertOutput> {
    return Promise.resolve(this.store.bulkUpsert(input));
  }

  // ─── Subscriptions ─────────────────────────────────────────────
  override getSubscriptions(): Promise<ItemsResult<DataModelSubscription>> {
    return Promise.resolve(asItems(this.store.subscriptions));
  }
  override getSubscription(
    nameOrId: string,
  ): Promise<DataModelSubscription | undefined> {
    return Promise.resolve(
      this.store.subscriptions.find(
        (s) => s.name === nameOrId || s.id === nameOrId,
      ),
    );
  }
  override replaceSubscription(
    nameOrId: string,
    input: DataModelSubscriptionInput,
  ): Promise<DataModelSubscription> {
    return Promise.resolve(this.store.replaceSubscription(nameOrId, input));
  }
  override async deleteSubscription(nameOrId: string): Promise<void> {
    this.store.deleteSubscription(nameOrId);
  }
  override async subscriptionStart(nameOrId: string): Promise<unknown> {
    this.store.startSubscription(nameOrId);
    return {};
  }
  override async subscriptionStop(nameOrId: string): Promise<unknown> {
    this.store.stopSubscription(nameOrId);
    return {};
  }
  override async subscriptionReset(
    nameOrId: string,
    request: SubscriptionResetRequest,
  ): Promise<unknown> {
    const seq = request.sequenceId ? Number(request.sequenceId) : undefined;
    this.store.resetSubscription(nameOrId, seq);
    return {};
  }

  // ─── DataModel Listeners (CRUD only in v1) ─────────────────────
  override getDataModelListeners(): Promise<ItemsResult<DataModelListener>> {
    return Promise.resolve(asItems(this.store.dataModelListeners));
  }
  override getDataModelListener(
    nameOrId: string,
  ): Promise<DataModelListener | undefined> {
    return Promise.resolve(
      this.store.dataModelListeners.find(
        (l) => l.name === nameOrId || l.id === nameOrId,
      ),
    );
  }
  override replaceDataModelListener(
    nameOrId: string,
    input: DataModelListenerInput,
  ): Promise<DataModelListener> {
    const list = this.store.dataModelListeners;
    const ix = list.findIndex((l) => l.name === nameOrId || l.id === nameOrId);
    if (ix >= 0) {
      Object.assign(list[ix], input);
      return Promise.resolve(list[ix]);
    }
    const fresh: DataModelListener = {
      id: cryptoRandomId(),
      name: input.name ?? nameOrId,
      ...input,
    };
    list.push(fresh);
    return Promise.resolve(fresh);
  }
  override async deleteDataModelListener(nameOrId: string): Promise<void> {
    const list = this.store.dataModelListeners;
    const ix = list.findIndex((l) => l.name === nameOrId || l.id === nameOrId);
    if (ix < 0) throw MsgItemNotFound("dataModelListeners", nameOrId);
    list.splice(ix, 1);
  }

  // ─── FireFly Listeners (CRUD only in v1) ───────────────────────
  override getFireFlyListeners(): Promise<ItemsResult<FireFlyListener>> {
    return Promise.resolve(asItems(this.store.fireflyListeners));
  }
  override getFireFlyListener(
    nameOrId: string,
  ): Promise<FireFlyListener | undefined> {
    return Promise.resolve(
      this.store.fireflyListeners.find(
        (l) => l.name === nameOrId || l.id === nameOrId,
      ),
    );
  }
  override replaceFireFlyListener(
    nameOrId: string,
    input: FireFlyListenerInput,
  ): Promise<FireFlyListener> {
    const list = this.store.fireflyListeners;
    const ix = list.findIndex((l) => l.name === nameOrId || l.id === nameOrId);
    if (ix >= 0) {
      Object.assign(list[ix], input);
      return Promise.resolve(list[ix]);
    }
    const fresh: FireFlyListener = {
      id: cryptoRandomId(),
      name: input.name ?? nameOrId,
      ...input,
    };
    list.push(fresh);
    return Promise.resolve(fresh);
  }
  override async deleteFireFlyListener(nameOrId: string): Promise<void> {
    const list = this.store.fireflyListeners;
    const ix = list.findIndex((l) => l.name === nameOrId || l.id === nameOrId);
    if (ix < 0) throw MsgItemNotFound("fireflyListeners", nameOrId);
    list.splice(ix, 1);
  }

  // ─── Out-of-scope-in-v1 methods ────────────────────────────────
  // Tasks, TaskVersions, Invocations, Policies, PolicyVersions, and
  // their inline variants throw MOCK000. See plan §6 coverage matrix.
  // All keep varargs so callers' typed signatures still compile.

  override getTasks(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getTasks"));
  }
  override getTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getTask"));
  }
  override replaceTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("replaceTask"));
  }
  override updateTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("updateTask"));
  }
  override deleteTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("deleteTask"));
  }
  override invokeTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokeTask"));
  }
  override invokeInlineTask(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokeInlineTask"));
  }
  override getTaskVersions(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getTaskVersions"));
  }
  override getTaskVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getTaskVersion"));
  }
  override createTaskVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("createTaskVersion"));
  }
  override updateTaskVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("updateTaskVersion"));
  }
  override deleteTaskVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("deleteTaskVersion"));
  }
  override invokeTaskVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokeTaskVersion"));
  }

  override getPolicies(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getPolicies"));
  }
  override getPolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getPolicy"));
  }
  override replacePolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("replacePolicy"));
  }
  override updatePolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("updatePolicy"));
  }
  override deletePolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("deletePolicy"));
  }
  override invokePolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokePolicy"));
  }
  override invokeInlinePolicy(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokeInlinePolicy"));
  }
  override getPolicyVersions(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getPolicyVersions"));
  }
  override getPolicyVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getPolicyVersion"));
  }
  override createPolicyVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("createPolicyVersion"));
  }
  override updatePolicyVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("updatePolicyVersion"));
  }
  override deletePolicyVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("deletePolicyVersion"));
  }
  override invokePolicyVersion(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invokePolicyVersion"));
  }

  override getInvocations(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getInvocations"));
  }
  override getInvocation(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("getInvocation"));
  }
  override deleteInvocation(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("deleteInvocation"));
  }
  override invocationFail(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invocationFail"));
  }
  override invocationReplay(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invocationReplay"));
  }
  override invocationSuspend(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invocationSuspend"));
  }
  override invocationResume(..._a: any[]): Promise<any> {
    return Promise.reject(MsgNotImplementedInMock("invocationResume"));
  }

  override getStepsCatalog(): Promise<any> {
    return Promise.resolve({ items: [], count: 0 });
  }

  // ─── Test-only ergonomics ──────────────────────────────────────

  /** Subscribe to an event-batch delivery. See plan §7. */
  listen(
    subscriptionNameOrId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.store.listen(subscriptionNameOrId, callback);
  }

  /** Drain pending events to all registered subscribers. */
  flushEvents(): Promise<void> {
    return this.store.flushEvents();
  }

  /** Reset the store between tests. */
  reset(): void {
    this.store.reset();
  }
}

function asItems<T>(arr: readonly T[]): ItemsResult<T> {
  return { items: arr as T[], count: arr.length, total: arr.length };
}

function cryptoRandomId(): string {
  // Local helper so listener inserts don't require pulling the
  // generator out of the store. UUID v4-ish.
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export type { EventBatchDelivery, SubscriptionCallback };
