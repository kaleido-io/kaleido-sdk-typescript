// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Descriptor table — one row per data-model resource. Encodes the
 * relational rules that the Go server enforces in
 * `firefly-enterprise/asset-manager/pkg/datamodel/`:
 *
 *   - which field is the human identity (name | address | protocolId)
 *   - whether identity is scoped under an address (pool/nft/fragment)
 *   - which fields hold KID refs to other resources (for resolution)
 *   - how to derive a denormalized `asset` KID on write
 *   - which children to cascade-delete on delete
 *
 * Keep this table the single source of truth. Adding a resource =
 * adding a row.
 */

export type ResourceKind =
  | "assets"
  | "addresses"
  | "pools"
  | "nfts"
  | "fragments"
  | "collections"
  | "activities"
  | "data"
  | "events"
  | "transfers"
  | "balanceChanges";

export type PolymorphicParentKind =
  | "asset"
  | "collection"
  | "address"
  | "pool"
  | "nft"
  | "fragment"
  | "data";

export const POLY_TO_KIND: Record<PolymorphicParentKind, ResourceKind> = {
  asset: "assets",
  collection: "collections",
  address: "addresses",
  pool: "pools",
  nft: "nfts",
  fragment: "fragments",
  data: "data",
};

export interface ResourceDescriptor {
  kind: ResourceKind;
  /** Field that identifies the resource for human lookup. */
  identityField: "name" | "address" | "protocolId";
  /** True for pool/nft/fragment — identity is unique per address. */
  addressScoped: boolean;
  /**
   * Fields on this resource whose value is a name/FQ-name/KID for
   * another resource. The store resolves these to KIDs on upsert and
   * stores both the original string (echo) and the KID (for queries).
   */
  refs: ReadonlyArray<{
    field: string;
    target: ResourceKind;
    /** When true, the target type is determined by a sibling field
     *  named `<field>.type` (polymorphic parents on data/events,
     *  transfers, balanceChanges). */
    polymorphic?: boolean;
    /** Field that carries the parent-type discriminator for
     *  polymorphic refs. */
    typeField?: string;
  }>;
  /**
   * How to derive the denormalized `asset` KID for this resource on
   * write. The Go server fills this column so that
   * `SELECT … WHERE asset = <kid>` is a single-column scan.
   */
  denormalizeAsset?:
    | { from: "self.asset" }              // pools/nfts/fragments
    | { from: "parent.asset" }            // data/events
    | { from: "transfer.parent.asset" };  // balanceChanges
  /** Resources whose rows are deleted when a row of this kind is deleted. */
  cascadeChildren: ReadonlyArray<{
    childKind: ResourceKind;
    /** Field on the child that holds the parent's identity value. */
    via: string;
    /** Field on the parent whose value the child stores. Defaults to
     *  "id". Addresses don't have a separate id — children store the
     *  address string, so `parentField: "address"` for those. */
    parentField?: string;
  }>;
}

export const DESCRIPTORS: Record<ResourceKind, ResourceDescriptor> = {
  assets: {
    kind: "assets",
    identityField: "name",
    addressScoped: false,
    refs: [{ field: "collection", target: "collections" }],
    cascadeChildren: [
      { childKind: "data", via: "asset" },
      { childKind: "events", via: "asset" },
      { childKind: "pools", via: "asset" },
      { childKind: "nfts", via: "asset" },
      { childKind: "fragments", via: "asset" },
    ],
  },
  addresses: {
    kind: "addresses",
    identityField: "address",
    addressScoped: false,
    refs: [],
    cascadeChildren: [
      { childKind: "pools", via: "address", parentField: "address" },
      { childKind: "nfts", via: "address", parentField: "address" },
      { childKind: "fragments", via: "address", parentField: "address" },
    ],
  },
  pools: {
    kind: "pools",
    identityField: "name",
    addressScoped: true,
    refs: [{ field: "asset", target: "assets" }],
    denormalizeAsset: { from: "self.asset" },
    cascadeChildren: [{ childKind: "transfers", via: "parent.ref" }],
  },
  nfts: {
    kind: "nfts",
    identityField: "name",
    addressScoped: true,
    refs: [{ field: "asset", target: "assets" }],
    denormalizeAsset: { from: "self.asset" },
    cascadeChildren: [{ childKind: "transfers", via: "parent.ref" }],
  },
  fragments: {
    kind: "fragments",
    identityField: "name",
    addressScoped: true,
    refs: [{ field: "asset", target: "assets" }],
    denormalizeAsset: { from: "self.asset" },
    cascadeChildren: [],
  },
  collections: {
    kind: "collections",
    identityField: "name",
    addressScoped: false,
    refs: [],
    cascadeChildren: [],
  },
  activities: {
    kind: "activities",
    identityField: "name",
    addressScoped: false,
    refs: [],
    cascadeChildren: [{ childKind: "events", via: "activity" }],
  },
  data: {
    kind: "data",
    identityField: "name",
    addressScoped: false,
    refs: [
      {
        field: "parent.ref",
        target: "assets", // placeholder; resolver picks via typeField
        polymorphic: true,
        typeField: "parent.type",
      },
    ],
    denormalizeAsset: { from: "parent.asset" },
    cascadeChildren: [],
  },
  events: {
    kind: "events",
    identityField: "name",
    addressScoped: false,
    refs: [
      { field: "activity", target: "activities" },
      {
        field: "parent.ref",
        target: "assets", // placeholder; resolver picks via typeField
        polymorphic: true,
        typeField: "parent.type",
      },
    ],
    denormalizeAsset: { from: "parent.asset" },
    cascadeChildren: [],
  },
  transfers: {
    kind: "transfers",
    identityField: "protocolId",
    addressScoped: false,
    refs: [
      {
        field: "parent.ref",
        target: "pools", // placeholder; resolver picks via typeField
        polymorphic: true,
        typeField: "parent.type",
      },
    ],
    denormalizeAsset: { from: "parent.asset" },
    cascadeChildren: [{ childKind: "balanceChanges", via: "transfer" }],
  },
  balanceChanges: {
    kind: "balanceChanges",
    identityField: "name",
    addressScoped: false,
    refs: [{ field: "transfer", target: "transfers" }],
    denormalizeAsset: { from: "transfer.parent.asset" },
    cascadeChildren: [],
  },
};
