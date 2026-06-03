// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  Activity,
  ActivityEvent,
  Address,
  Asset,
  BalanceChange,
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  BulkUpsertOutput,
  Collection,
  Data,
  DataModelListener,
  DataModelSubscription,
  DataModelSubscriptionInput,
  FilterResult,
  FireFlyListener,
  Fragment,
  NameAndID,
  NFT,
  Pool,
  Transfer,
  UpdateType,
  UpsertManyResult,
} from "../src/asset-manager.interfaces.js";
import { DESCRIPTORS, ResourceKind } from "./descriptors.js";
import {
  BalanceBookkeepingContext,
  balanceKey,
  generateBalanceChanges,
} from "./balances.js";
import {
  EventBatchDelivery,
  EventBus,
  SubscriptionCallback,
} from "./events.js";
import {
  MsgInvalidRef,
  MsgItemAlreadyExists,
  MsgItemNotFound,
} from "./errors.js";
import { runQuery } from "./filter.js";
import { buildFQName } from "./fqname.js";
import { IdGenerator, nowIso, uuidIds } from "./ids.js";
import { RefResolver } from "./resolver.js";

export interface MockAssetManagerStoreOptions {
  idGenerator?: IdGenerator;
  clock?: () => number;
  /** Default 'manual' — tests drain via `flushEvents()`. */
  eventDelivery?: "manual" | "auto";
}

interface UpsertScratch {
  result: BulkUpsertOutput;
  /** Activity events that were newly inserted/updated this call.
   *  Drained into the EventBus after the upsert transaction. */
  emittedEvents: ActivityEvent[];
}

/**
 * In-memory, server-faithful Asset Manager state.
 *
 * The brain. All typed client methods route through `bulkUpsert` /
 * `bulkQuery` against this store, plus a small set of out-of-band
 * registries for subscriptions and listeners.
 *
 * Public arrays are read-only — mutate through `seed()` or
 * `bulkUpsert()` so invariants (ref resolution, asset
 * denormalization, balance bookkeeping, cascade) are upheld.
 */
export class AssetManagerStore {
  // Data-model rows
  private _assets: Asset[] = [];
  private _addresses: Address[] = [];
  private _pools: Pool[] = [];
  private _nfts: NFT[] = [];
  private _fragments: Fragment[] = [];
  private _collections: Collection[] = [];
  private _activities: Activity[] = [];
  private _data: Data[] = [];
  private _events: ActivityEvent[] = [];
  private _transfers: Transfer[] = [];
  private _balanceChanges: BalanceChange[] = [];

  // Out-of-band registries
  readonly subscriptions: DataModelSubscription[] = [];
  readonly dataModelListeners: DataModelListener[] = [];
  readonly fireflyListeners: FireFlyListener[] = [];

  private latestBalances = new Map<string, BalanceChange>();
  private eventSequence = 0;

  private readonly idGenerator: IdGenerator;
  private readonly clock?: () => number;
  private readonly resolver: RefResolver;
  private readonly bus: EventBus;

  constructor(opts: MockAssetManagerStoreOptions = {}) {
    this.idGenerator = opts.idGenerator ?? uuidIds;
    this.clock = opts.clock;
    this.resolver = new RefResolver((kind) => this.rowsFor(kind));
    this.bus = new EventBus(opts.eventDelivery ?? "manual", () => this._events);
  }

  // ─── public read-only views ─────────────────────────────────────

  get assets(): readonly Asset[] {
    return this._assets;
  }
  get addresses(): readonly Address[] {
    return this._addresses;
  }
  get pools(): readonly Pool[] {
    return this._pools;
  }
  get nfts(): readonly NFT[] {
    return this._nfts;
  }
  get fragments(): readonly Fragment[] {
    return this._fragments;
  }
  get collections(): readonly Collection[] {
    return this._collections;
  }
  get activities(): readonly Activity[] {
    return this._activities;
  }
  get data(): readonly Data[] {
    return this._data;
  }
  get events(): readonly ActivityEvent[] {
    return this._events;
  }
  get transfers(): readonly Transfer[] {
    return this._transfers;
  }
  get balanceChanges(): readonly BalanceChange[] {
    return this._balanceChanges;
  }

  // ─── lifecycle ──────────────────────────────────────────────────

  reset(): void {
    this._assets = [];
    this._addresses = [];
    this._pools = [];
    this._nfts = [];
    this._fragments = [];
    this._collections = [];
    this._activities = [];
    this._data = [];
    this._events = [];
    this._transfers = [];
    this._balanceChanges = [];
    this.subscriptions.length = 0;
    this.dataModelListeners.length = 0;
    this.fireflyListeners.length = 0;
    this.latestBalances.clear();
    this.eventSequence = 0;
  }

  // ─── identity lookup ────────────────────────────────────────────

  /** Look up by id or human identity (name/address/protocolId).
   *  For address-scoped kinds, also accepts the "<address>/<name>"
   *  FQ form. */
  findByIdentity<T extends Record<string, any>>(
    kind: ResourceKind,
    nameOrId: string,
  ): T | undefined {
    const desc = DESCRIPTORS[kind];
    const rows = this.rowsFor(kind) as T[];
    const byId = rows.find((r) => r.id === nameOrId);
    if (byId) return byId;
    if (desc.addressScoped && nameOrId.includes("/")) {
      const slash = nameOrId.indexOf("/");
      const address = nameOrId.slice(0, slash);
      const name = nameOrId.slice(slash + 1);
      return rows.find(
        (r) => r.address === address && r[desc.identityField] === name,
      );
    }
    return rows.find((r) => r[desc.identityField] === nameOrId);
  }

  // ─── bulk paths ─────────────────────────────────────────────────

  /**
   * Same path as `bulkUpsert` — provided as a sugar method so test
   * setup code reads as `store.seed(...)`.
   */
  seed(input: BulkUpsertInput): BulkUpsertOutput {
    return this.bulkUpsert(input);
  }

  bulkUpsert(input: BulkUpsertInput): BulkUpsertOutput {
    const scratch: UpsertScratch = {
      result: {},
      emittedEvents: [],
    };

    // Order matters for ref resolution: write parents before children
    // so a child's ref into a parent created in the same bulk
    // resolves.
    this.upsertList("collections", input.collections, scratch);
    this.upsertList("assets", input.assets, scratch);
    this.upsertList("addresses", input.addresses, scratch);
    this.upsertList("pools", input.pools, scratch);
    this.upsertList("nfts", input.nfts, scratch);
    this.upsertList("fragments", input.fragments, scratch);
    this.upsertList("activities", input.activities, scratch);
    this.upsertList("data", input.data, scratch);
    this.upsertList("events", input.events, scratch);
    this.upsertList("transfers", input.transfers, scratch);

    // Push activity events into the event bus. Auto mode schedules a
    // microtask flush; manual mode waits for explicit `flushEvents`.
    for (const e of scratch.emittedEvents) {
      this.bus.enqueueEvent(e);
    }

    return scratch.result;
  }

  bulkQuery(input: BulkQueryInput): BulkQueryOutput {
    const out: BulkQueryOutput = {};
    if (input.activities !== undefined)
      out.activities = this.runQ(
        "activities",
        input.activities,
      ) as FilterResult<Activity>;
    if (input.addresses !== undefined)
      out.addresses = this.runQ(
        "addresses",
        input.addresses,
      ) as FilterResult<Address>;
    if (input.assets !== undefined)
      out.assets = this.runQ("assets", input.assets) as FilterResult<Asset>;
    if (input.collections !== undefined)
      out.collections = this.runQ(
        "collections",
        input.collections,
      ) as FilterResult<Collection>;
    if (input.data !== undefined)
      out.data = this.runQ("data", input.data) as FilterResult<Data>;
    if (input.events !== undefined)
      out.events = this.runQ(
        "events",
        input.events,
      ) as FilterResult<ActivityEvent>;
    if (input.fragments !== undefined)
      out.fragments = this.runQ(
        "fragments",
        input.fragments,
      ) as FilterResult<Fragment>;
    if (input.nfts !== undefined)
      out.nfts = this.runQ("nfts", input.nfts) as FilterResult<NFT>;
    if (input.pools !== undefined)
      out.pools = this.runQ("pools", input.pools) as FilterResult<Pool>;
    if (input.transfers !== undefined)
      out.transfers = this.runQ(
        "transfers",
        input.transfers,
      ) as FilterResult<Transfer>;
    if (input.balanceChanges !== undefined)
      out.balanceChanges = this.runQ(
        "balanceChanges",
        input.balanceChanges,
      ) as FilterResult<BalanceChange>;
    return out;
  }

  private runQ(kind: ResourceKind, q: any): FilterResult<any> {
    const res = runQuery(kind, this.rowsFor(kind) as any[], q, this.resolver);
    return {
      items: res.items,
      count: res.count,
      total: res.total,
      allItems: res.allItems,
    };
  }

  // ─── delete with cascade ────────────────────────────────────────

  delete(kind: ResourceKind, idOrIdentity: string): void {
    const row = this.findByIdentity<any>(kind, idOrIdentity);
    if (!row) throw MsgItemNotFound(kind, idOrIdentity);
    this.deleteRow(kind, row.id);
  }

  private deleteRow(kind: ResourceKind, id: string): void {
    const desc = DESCRIPTORS[kind];
    // Read the parent's identity value once for cascade matching.
    const parent = this.rowsFor(kind).find((r: any) => r.id === id);
    if (!parent) return;

    for (const c of desc.cascadeChildren) {
      const parentValue = readPath(parent, c.parentField ?? "id");
      if (parentValue === undefined) continue;
      const childRows = this.rowsFor(c.childKind);
      const victims = childRows.filter(
        (r: any) => readPath(r, c.via) === parentValue,
      );
      for (const v of victims) this.deleteRow(c.childKind, v.id);
    }

    const arr = this.rowsFor(kind) as any[];
    const ix = arr.findIndex((r) => r.id === id);
    if (ix >= 0) arr.splice(ix, 1);
  }

  // ─── subscriptions / event bus ──────────────────────────────────

  replaceSubscription(
    nameOrId: string,
    input: DataModelSubscriptionInput,
  ): DataModelSubscription {
    const existing = this.subscriptions.find(
      (s) => s.name === nameOrId || s.id === nameOrId,
    );
    if (existing) {
      Object.assign(existing, input, { updated: nowIso(this.clock) });
      this.bus.upsertSubscription(existing);
      return existing;
    }
    const created: DataModelSubscription = {
      id: this.idGenerator(),
      created: nowIso(this.clock),
      updated: nowIso(this.clock),
      status: "started",
      ...input,
      name: input.name ?? nameOrId,
    };
    this.subscriptions.push(created);
    this.bus.upsertSubscription(created);
    return created;
  }

  deleteSubscription(nameOrId: string): void {
    const ix = this.subscriptions.findIndex(
      (s) => s.name === nameOrId || s.id === nameOrId,
    );
    if (ix < 0) throw MsgItemNotFound("subscriptions", nameOrId);
    this.subscriptions.splice(ix, 1);
    this.bus.removeSubscription(nameOrId);
  }

  startSubscription(nameOrId: string): void {
    const sub = this.subscriptions.find(
      (s) => s.name === nameOrId || s.id === nameOrId,
    );
    if (sub) sub.status = "started";
    this.bus.start(nameOrId);
  }

  stopSubscription(nameOrId: string): void {
    const sub = this.subscriptions.find(
      (s) => s.name === nameOrId || s.id === nameOrId,
    );
    if (sub) sub.status = "stopped";
    this.bus.stop(nameOrId);
  }

  resetSubscription(nameOrId: string, sequenceId?: number): void {
    this.bus.reset(nameOrId, sequenceId);
  }

  /**
   * Register a callback for batch delivery. Returns an unsubscribe.
   * The subscription record does not need to exist yet — a
   * placeholder is created and replaced when the test seeds the
   * real record.
   */
  listen(
    subscriptionNameOrId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.bus.listen(subscriptionNameOrId, callback);
  }

  flushEvents(): Promise<void> {
    return this.bus.flushEvents();
  }

  // ─── internals ──────────────────────────────────────────────────

  private rowsFor(kind: ResourceKind): any[] {
    switch (kind) {
      case "assets":
        return this._assets;
      case "addresses":
        return this._addresses;
      case "pools":
        return this._pools;
      case "nfts":
        return this._nfts;
      case "fragments":
        return this._fragments;
      case "collections":
        return this._collections;
      case "activities":
        return this._activities;
      case "data":
        return this._data;
      case "events":
        return this._events;
      case "transfers":
        return this._transfers;
      case "balanceChanges":
        return this._balanceChanges;
    }
  }

  private upsertList(
    kind: ResourceKind,
    inputs: any[] | undefined,
    scratch: UpsertScratch,
  ): void {
    if (!inputs?.length) return;
    const desc = DESCRIPTORS[kind];
    const collection = this.rowsFor(kind);
    const out: Required<UpsertManyResult> = {
      created: [],
      replaced: [],
      updated: [],
      ignored: [],
    };

    for (const input of inputs) {
      const identity = input[desc.identityField];
      if (!identity) {
        throw MsgInvalidRef(kind, "<missing identity field>");
      }

      // Resolve human refs on the input → store both the original
      // string echo and a denormalized parent-id if applicable.
      const prepared = this.prepareInput(kind, input);

      // Find by identity (address-scoped tables key on (address, identity)).
      const ix = collection.findIndex((r) =>
        desc.addressScoped
          ? r.address === prepared.address && r[desc.identityField] === identity
          : r[desc.identityField] === identity,
      );
      const existing = ix >= 0 ? collection[ix] : undefined;

      const updateType: UpdateType =
        (input.updateType as UpdateType) ?? "create_or_replace";
      const nameRef: NameAndID = { name: identity, id: existing?.id };

      if (existing) {
        if (updateType === "create_only") {
          throw MsgItemAlreadyExists(kind, identity);
        }
        if (updateType === "create_or_ignore") {
          // Labels still merge per server semantics.
          existing.labels = { ...existing.labels, ...prepared.labels };
          out.ignored.push({ ...nameRef, id: existing.id });
          continue;
        }
        if (updateType === "update_only" || updateType === "create_or_update") {
          this.applyPatch(existing, prepared);
          existing.updated = nowIso(this.clock);
          out.updated.push({ ...nameRef, id: existing.id });
          this.postWriteHook(kind, existing, scratch);
          continue;
        }
        // create_or_replace: keep id + created; overwrite the rest.
        const replaced = {
          ...prepared,
          id: existing.id,
          created: existing.created,
          updated: nowIso(this.clock),
        };
        collection.splice(ix, 1, replaced);
        out.replaced.push({ ...nameRef, id: existing.id });
        this.postWriteHook(kind, replaced, scratch);
        continue;
      }

      if (updateType === "update_only") {
        throw MsgItemNotFound(kind, identity);
      }
      const now = nowIso(this.clock);
      const fresh = {
        ...prepared,
        id: this.idGenerator(),
        created: now,
        updated: now,
      };
      collection.push(fresh);
      out.created.push({ ...nameRef, id: fresh.id });
      this.postWriteHook(kind, fresh, scratch);
    }

    // Stash a typed result on the output.
    (scratch.result as any)[kind] = trimEmpty(out);
  }

  /**
   * Strip the `updateType` opt and normalize the row. Performs ref
   * validation that the server does up-front (e.g. parent.type +
   * parent.ref both set, address required for address-scoped
   * resources).
   */
  private prepareInput(kind: ResourceKind, input: any): any {
    const desc = DESCRIPTORS[kind];
    const { updateType: _updateType, ...rest } = input;
    const row: any = { ...rest };

    if (desc.addressScoped) {
      const addr = row.address;
      if (
        !addr &&
        row[desc.identityField] &&
        row[desc.identityField].includes("/")
      ) {
        // Accept "address/name" written into the identity field.
        const [a, n] = String(row[desc.identityField]).split("/", 2);
        row.address = a;
        row[desc.identityField] = n;
      }
      if (!row.address) {
        throw MsgInvalidRef(
          kind,
          `<missing address for ${row[desc.identityField]}>`,
        );
      }
      row.qualifiedName = buildFQName(row.address, row[desc.identityField]);
    }

    return row;
  }

  /**
   * Patch helper for `update_only` / `create_or_update`. Labels
   * deep-merge; everything else is shallow-overwrite. Empty-string
   * fields are kept (matching server "explicit empty" semantics).
   */
  private applyPatch(existing: any, patch: any): void {
    const { labels: patchLabels, ...rest } = patch;
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) existing[k] = v;
    }
    if (patchLabels) {
      existing.labels = { ...existing.labels, ...patchLabels };
    }
  }

  /**
   * Post-write hook: denormalize `asset`, generate balance changes,
   * derive event topic, etc.
   */
  private postWriteHook(
    kind: ResourceKind,
    row: any,
    scratch: UpsertScratch,
  ): void {
    const desc = DESCRIPTORS[kind];

    // 1) Denormalize `asset`
    if (desc.denormalizeAsset) {
      this.denormalizeAsset(kind, row);
    }

    // 2) Per-kind specifics
    switch (kind) {
      case "transfers":
        this.afterTransferWrite(row as Transfer);
        break;
      case "events":
        this.afterEventWrite(row as ActivityEvent, scratch);
        break;
    }
  }

  private denormalizeAsset(kind: ResourceKind, row: any): void {
    if (kind === "pools" || kind === "nfts" || kind === "fragments") {
      // The input's `asset` is a name/FQ/id — resolve to id and store
      // both: keep the original string under `assetName` for echo if
      // present? Server stores only the KID. We store the id but echo
      // back the resolved entry on read by leaving `asset` as a string
      // ref. The pragmatic choice: store the resolved id under `asset`.
      if (row.asset) {
        const id = this.resolver.resolve("assets", row.asset);
        if (id) row.asset = id;
      }
      return;
    }
    if (kind === "data" || kind === "events") {
      const parent = row.parent;
      if (!parent?.type || !parent?.ref) return;
      const target = this.resolver.resolveParent(parent.type, parent.ref);
      if (!target) return;
      // Rewrite parent.ref to the resolved id for storage.
      const parentRow = this.findByIdentity<any>(
        target.kind,
        target.id ?? parent.ref,
      );
      if (parentRow) {
        row.parent = { type: parent.type, ref: parentRow.id };
        if (target.kind === "assets") {
          row.asset = parentRow.id;
        } else if (parentRow.asset) {
          row.asset = parentRow.asset; // already a kid post-denorm
        }
      }
      return;
    }
    if (kind === "balanceChanges") {
      // Already set by transfer-write path; nothing to do.
      return;
    }
  }

  private afterTransferWrite(t: Transfer): void {
    if (!t.parent?.type || !t.parent?.ref) return;
    // Resolve parent ref to id and stash the parent's asset.
    const target = this.resolver.resolveParent(t.parent.type, t.parent.ref);
    if (!target?.id) return;
    const parentRow = this.findByIdentity<any>(target.kind, target.id);
    if (parentRow) {
      t.parent = { type: t.parent.type, ref: parentRow.id };
      if (parentRow.asset) t.asset = parentRow.asset;
    }

    // Generate balance changes.
    const ctx: BalanceBookkeepingContext = {
      latestBalances: this.latestBalances,
      idGenerator: this.idGenerator,
      clock: this.clock,
    };
    const changes = generateBalanceChanges(t, t.parent.ref!, ctx);
    for (const bc of changes) {
      // Pre-existing row with the same name should be replaced
      // (caller can re-run a transfer in tests).
      const ix = this._balanceChanges.findIndex((b) => b.name === bc.name);
      if (ix >= 0) this._balanceChanges.splice(ix, 1, bc);
      else this._balanceChanges.push(bc);
    }
  }

  private afterEventWrite(e: ActivityEvent, scratch: UpsertScratch): void {
    // Resolve activity ref.
    if (e.activity) {
      const id = this.resolver.resolve("activities", e.activity);
      if (id) {
        const act = this._activities.find((a) => a.id === id);
        if (act && !e.topic) {
          e.topic = `${act.name}/${e.name}`;
        }
        e.activity = id;
      }
    }
    // Assign a monotonic sequence so subscriptions can cursor-track.
    e.sequence = ++this.eventSequence;
    scratch.emittedEvents.push(e);
  }

  /**
   * Latest-balance read used by the typed-client balance methods.
   */
  latestBalanceAt(
    parentRefId: string,
    address: string,
  ): BalanceChange | undefined {
    return this.latestBalances.get(balanceKey(parentRefId, address));
  }

  /**
   * Surface for tests that want to assert on the full delivery flow.
   */
  static isEventBatch(x: unknown): x is EventBatchDelivery {
    return (
      typeof x === "object" && x !== null && (x as any).type === "event_batch"
    );
  }
}

function readPath(obj: any, path: string): unknown {
  if (!path.includes(".")) return obj?.[path];
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function trimEmpty(r: Required<UpsertManyResult>): UpsertManyResult {
  const out: UpsertManyResult = {};
  if (r.created.length) out.created = r.created;
  if (r.replaced.length) out.replaced = r.replaced;
  if (r.updated.length) out.updated = r.updated;
  if (r.ignored.length) out.ignored = r.ignored;
  return out;
}
