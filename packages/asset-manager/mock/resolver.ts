// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  DESCRIPTORS,
  POLY_TO_KIND,
  PolymorphicParentKind,
  ResourceKind,
} from "./descriptors.js";
import { looksLikeId, parseFQName } from "./fqname.js";
import { MsgInvalidRef } from "./errors.js";

/**
 * Resolves human refs (name | "<address>/<name>" | id) to ids,
 * scanning the in-memory row collections. Mirrors
 * `resolveAssetID`/`resolveAddressScopedParentID` etc. in
 * `pkg/datamodel/bulk_query.go`.
 */
export class RefResolver {
  /**
   * @param rowsFor returns the current rows of a given kind. The
   * store passes a live accessor so resolution always sees the
   * latest state (important during a single bulk upsert that creates
   * an asset and then references it from a pool).
   */
  constructor(private rowsFor: (kind: ResourceKind) => readonly any[]) {}

  /**
   * Resolve a ref to an id. Returns undefined if not found.
   * Throws if `opts.required` is set and resolution fails.
   */
  resolve(
    targetKind: ResourceKind,
    ref: string | undefined,
    opts?: { required?: boolean },
  ): string | undefined {
    if (!ref) return undefined;
    if (looksLikeId(ref)) return ref;

    const desc = DESCRIPTORS[targetKind];
    const rows = this.rowsFor(targetKind);

    if (desc.addressScoped) {
      const { parent, name } = parseFQName(ref);
      if (!parent) {
        if (opts?.required) throw MsgInvalidRef(targetKind, ref);
        return undefined;
      }
      const match = rows.find(
        (r) => r.address === parent && r[desc.identityField] === name,
      );
      if (!match && opts?.required) throw MsgInvalidRef(targetKind, ref);
      return match?.id;
    }

    const match = rows.find((r) => r[desc.identityField] === ref);
    if (!match && opts?.required) throw MsgInvalidRef(targetKind, ref);
    return match?.id;
  }

  /**
   * Resolve a polymorphic parent ref. Used by Data, Event, Transfer,
   * BalanceChange.
   */
  resolveParent(
    parentType: PolymorphicParentKind | undefined,
    ref: string | undefined,
    opts?: { required?: boolean },
  ): { kind: ResourceKind; id: string | undefined } | undefined {
    if (!parentType || !ref) return undefined;
    const kind = POLY_TO_KIND[parentType];
    if (!kind) return undefined;
    return { kind, id: this.resolve(kind, ref, opts) };
  }
}
