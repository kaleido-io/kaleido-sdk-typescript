// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  DataModelQueryJSON,
  FilterJSON,
  FilterJSONKeyValue,
  FilterJSONKeyValues,
  FilterJSONOps,
} from "../src/asset-manager.interfaces.js";
import { ResourceKind } from "./descriptors.js";
import { MsgFilterFieldUnknown, MsgScopeQueryMissed } from "./errors.js";
import { RefResolver } from "./resolver.js";

/**
 * Set of fields that auto-resolve from name → id at query time.
 * Mirrors `valueResolver` in `bulk_query.go:227`.
 */
const AUTO_RESOLVE_FIELDS: Record<
  ResourceKind,
  ReadonlyArray<{
    field: string;
    target: ResourceKind | "polymorphic";
  }>
> = {
  assets: [{ field: "collection", target: "collections" }],
  addresses: [],
  pools: [{ field: "asset", target: "assets" }],
  nfts: [{ field: "asset", target: "assets" }],
  fragments: [{ field: "asset", target: "assets" }],
  collections: [],
  activities: [],
  data: [
    { field: "asset", target: "assets" },
    { field: "collection", target: "collections" },
    { field: "parent.ref", target: "polymorphic" },
  ],
  events: [
    { field: "asset", target: "assets" },
    { field: "activity", target: "activities" },
    { field: "parent.ref", target: "polymorphic" },
  ],
  transfers: [
    { field: "asset", target: "assets" },
    { field: "parent.ref", target: "polymorphic" },
  ],
  balanceChanges: [
    { field: "asset", target: "assets" },
    { field: "transfer", target: "transfers" },
    { field: "parent.ref", target: "polymorphic" },
  ],
};

/**
 * Known filter fields per resource. Mirrors the Go `*Filters`
 * registries (`asset.go`, `activity.go`, etc.). Filtering on a field
 * not in this set throws KA090301.
 *
 * Conservative set — covers what bank-server's existing queries hit
 * plus the obvious additions. Easy to extend.
 */
const KNOWN_FIELDS: Record<ResourceKind, ReadonlySet<string>> = {
  assets: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "collection",
  ]),
  addresses: new Set([
    "id",
    "created",
    "updated",
    "address",
    "displayName",
    "description",
    "info",
    "contract",
  ]),
  pools: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "asset",
    "address",
    "standard",
    "qualifiedName",
  ]),
  nfts: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "asset",
    "address",
    "standard",
    "tokenIndex",
    "active",
    "qualifiedName",
  ]),
  fragments: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "asset",
    "address",
    "value",
    "valueMasked",
    "valueReference",
    "qualifiedName",
  ]),
  collections: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
  ]),
  activities: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
  ]),
  data: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "asset",
    "uri",
    "transactionHash",
    "role",
    "parent.type",
    "parent.ref",
  ]),
  events: new Set([
    "id",
    "created",
    "updated",
    "name",
    "displayName",
    "description",
    "info",
    "topic",
    "activity",
    "asset",
    "sequence",
    "parent.type",
    "parent.ref",
  ]),
  transfers: new Set([
    "id",
    "created",
    "updated",
    "protocolId",
    "displayName",
    "description",
    "info",
    "type",
    "signer",
    "from",
    "to",
    "amount",
    "transactionHash",
    "asset",
    "parent.type",
    "parent.ref",
  ]),
  balanceChanges: new Set([
    "id",
    "created",
    "updated",
    "name",
    "asset",
    "transfer",
    "address",
    "amount",
    "operation",
    "balanceBefore",
    "balanceAfter",
    "parent.type",
    "parent.ref",
  ]),
};

function getPath(obj: any, path: string): unknown {
  if (!obj) return undefined;
  if (!path.includes(".")) return obj[path];
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function strEq(a: unknown, b: unknown, caseInsensitive?: boolean): boolean {
  if (a == null || b == null) return a === b;
  if (caseInsensitive && typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return String(a) === String(b);
}

function getEqsOnLevel(level: FilterJSONOps): FilterJSONKeyValue[] {
  return [...(level.equal ?? []), ...(level.eq ?? [])];
}

/**
 * Find a field value among the eq/equal clauses at a filter level.
 * Used to read `parent.type` so we know how to resolve `parent.ref`.
 */
function findEqValue(level: FilterJSONOps, field: string): string | undefined {
  for (const kv of getEqsOnLevel(level)) {
    if (kv.field === field) return kv.value;
  }
  return undefined;
}

export interface FilterContext {
  kind: ResourceKind;
  resolver: RefResolver;
}

/**
 * Resolve a filter value for auto-resolution fields (asset / activity
 * / collection / parent.ref / transfer). Pass-through for everything
 * else.
 */
function resolveFilterValue(
  ctx: FilterContext,
  level: FilterJSONOps,
  field: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const rules = AUTO_RESOLVE_FIELDS[ctx.kind];
  const rule = rules.find((r) => r.field === field);
  if (!rule) return value;

  if (rule.target === "polymorphic") {
    const parentType = findEqValue(level, "parent.type");
    if (!parentType) throw MsgScopeQueryMissed(ctx.kind, "parent.ref");
    const resolved = ctx.resolver.resolveParent(parentType as any, value);
    return resolved?.id;
  }

  return ctx.resolver.resolve(rule.target, value);
}

function checkKnownField(ctx: FilterContext, field: string): void {
  // Labels are matched against the labels record, not the resource
  // field set; skip the registry check for label.* paths.
  if (field.startsWith("label.")) return;
  if (!KNOWN_FIELDS[ctx.kind].has(field)) {
    throw MsgFilterFieldUnknown(ctx.kind, field);
  }
}

function matchKV(
  ctx: FilterContext,
  level: FilterJSONOps,
  kv: FilterJSONKeyValue,
  item: any,
  op: "eq" | "neq" | "contains" | "lt" | "lte" | "gt" | "gte",
): boolean {
  if (!kv.field) return true;
  checkKnownField(ctx, kv.field);
  const want = resolveFilterValue(ctx, level, kv.field, kv.value);
  const got = getPath(item, kv.field);

  let result: boolean;
  switch (op) {
    case "eq":
      result = strEq(got, want, kv.caseInsensitive);
      break;
    case "neq":
      result = !strEq(got, want, kv.caseInsensitive);
      break;
    case "contains":
      result =
        typeof got === "string" &&
        typeof want === "string" &&
        (kv.caseInsensitive
          ? got.toLowerCase().includes(want.toLowerCase())
          : got.includes(want));
      break;
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const a = numeric(got);
      const b = numeric(want);
      if (a === undefined || b === undefined) {
        result = false;
      } else if (op === "lt") result = a < b;
      else if (op === "lte") result = a <= b;
      else if (op === "gt") result = a > b;
      else result = a >= b;
      break;
    }
  }

  return kv.not ? !result : result;
}

function numeric(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    // Time strings sort lexicographically when ISO-formatted, but
    // BigInt-shaped balances need string compare too. For now: number
    // parse, else fall back to char-by-char compare via string.
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function matchKVs(
  ctx: FilterContext,
  level: FilterJSONOps,
  kvs: FilterJSONKeyValue[] | undefined,
  item: any,
  op: "eq" | "neq" | "contains" | "lt" | "lte" | "gt" | "gte",
): boolean {
  if (!kvs?.length) return true;
  return kvs.every((kv) => matchKV(ctx, level, kv, item, op));
}

function matchIn(
  ctx: FilterContext,
  level: FilterJSONOps,
  kvs: FilterJSONKeyValues[] | undefined,
  item: any,
  negate: boolean,
): boolean {
  if (!kvs?.length) return true;
  for (const kv of kvs) {
    if (!kv.field) continue;
    checkKnownField(ctx, kv.field);
    const got = getPath(item, kv.field);
    const values = (kv.values ?? []).map((v) =>
      resolveFilterValue(ctx, level, kv.field!, v),
    );
    const hit = values.some((w) => strEq(got, w, kv.caseInsensitive));
    if (negate ? hit : !hit) return false;
  }
  return true;
}

function matchOps(
  ctx: FilterContext,
  level: FilterJSONOps,
  item: any,
): boolean {
  return (
    matchKVs(ctx, level, level.equal, item, "eq") &&
    matchKVs(ctx, level, level.eq, item, "eq") &&
    matchKVs(ctx, level, level.neq, item, "neq") &&
    matchKVs(ctx, level, level.contains, item, "contains") &&
    matchKVs(ctx, level, level.lt, item, "lt") &&
    matchKVs(ctx, level, level.lessThan, item, "lt") &&
    matchKVs(ctx, level, level.lte, item, "lte") &&
    matchKVs(ctx, level, level.lessThanOrEqual, item, "lte") &&
    matchKVs(ctx, level, level.gt, item, "gt") &&
    matchKVs(ctx, level, level.greaterThan, item, "gt") &&
    matchKVs(ctx, level, level.gte, item, "gte") &&
    matchKVs(ctx, level, level.greaterThanOrEqual, item, "gte") &&
    matchIn(ctx, level, level.in, item, false) &&
    matchIn(ctx, level, level.nin, item, true)
  );
}

function matchFilter(
  ctx: FilterContext,
  filter: FilterJSON,
  item: any,
): boolean {
  if (!matchOps(ctx, filter, item)) return false;
  if (filter.or?.length) {
    return filter.or.some((sub) => matchFilter(ctx, sub, item));
  }
  return true;
}

/**
 * Match labels filter against the labels record. Labels carry no
 * known-field validation — any label key is allowed.
 */
function matchLabels(
  ops: FilterJSONOps | undefined,
  labels: Record<string, string> | undefined,
): boolean {
  if (!ops) return true;
  const lab = labels ?? {};
  const fakeCtx: FilterContext = null as any; // unused — labels skip auto-resolve
  const item = lab;
  // Reuse the ops walker but with relaxed field-checking. We inline a
  // micro version to avoid mutating the main path.
  const each = (kvs: FilterJSONKeyValue[] | undefined, op: "eq" | "neq") =>
    !kvs?.length ||
    kvs.every((kv) => {
      if (!kv.field) return true;
      const got = item[kv.field];
      const want = kv.value;
      const eq = strEq(got, want, kv.caseInsensitive);
      const res = op === "eq" ? eq : !eq;
      return kv.not ? !res : res;
    });
  const inOp = (kvs: FilterJSONKeyValues[] | undefined, negate: boolean) =>
    !kvs?.length ||
    kvs.every((kv) => {
      if (!kv.field) return true;
      const got = item[kv.field];
      const hit = (kv.values ?? []).some((w) =>
        strEq(got, w, kv.caseInsensitive),
      );
      return negate ? !hit : hit;
    });
  void fakeCtx;
  return (
    each(ops.equal, "eq") &&
    each(ops.eq, "eq") &&
    each(ops.neq, "neq") &&
    inOp(ops.in, false) &&
    inOp(ops.nin, true)
  );
}

function sortItems<T extends Record<string, any>>(
  items: T[],
  sort: string[] | undefined,
): T[] {
  if (!sort?.length) {
    // Default: created desc
    return [...items].sort((a, b) =>
      String(b.created ?? "").localeCompare(String(a.created ?? "")),
    );
  }
  const compiled = sort.map((s) => {
    if (s.startsWith("-")) return { field: s.slice(1), dir: -1 as const };
    return { field: s, dir: 1 as const };
  });
  return [...items].sort((a, b) => {
    for (const { field, dir } of compiled) {
      const av = getPath(a, field);
      const bv = getPath(b, field);
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

export function runQuery<T extends Record<string, any>>(
  kind: ResourceKind,
  rows: readonly T[],
  query: DataModelQueryJSON | undefined,
  resolver: RefResolver,
): { items: T[]; count: number; total: number; allItems: boolean } {
  if (query === undefined) {
    return { items: [], count: 0, total: 0, allItems: true };
  }
  const ctx: FilterContext = { kind, resolver };
  const filtered = rows.filter(
    (r) => matchFilter(ctx, query, r) && matchLabels(query.labels, r.labels),
  );

  const sorted = sortItems(filtered, query.sort);
  const skip = query.skip ?? 0;
  const limit = query.limit;
  const sliced =
    limit === undefined ? sorted.slice(skip) : sorted.slice(skip, skip + limit);

  return {
    items: sliced,
    count: sliced.length,
    total: filtered.length,
    allItems: skip === 0 && (limit === undefined || sliced.length < limit),
  };
}
