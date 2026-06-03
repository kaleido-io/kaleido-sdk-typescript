// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Asset Manager uses three reference shapes for `DataModelReference`
 * fields:
 *   1. a bare name: "asset1"
 *   2. an address-scoped FQ name: "0xAAA…/pool1"
 *   3. a KID/UUID
 *
 * Pool/NFT/Fragment live under an address; their canonical "name" is
 * `<address>/<name>`. Data/Event/Transfer parents can be either flat
 * names (asset/collection/activity/address) or FQ names (pool/nft/
 * fragment).
 */

export interface ParsedFQName {
  parent?: string;
  name: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOCK_ID_RE = /^mock-[a-zA-Z0-9_-]+$/;

export function looksLikeId(s: string): boolean {
  return UUID_RE.test(s) || MOCK_ID_RE.test(s);
}

export function parseFQName(ref: string): ParsedFQName {
  const slash = ref.indexOf("/");
  if (slash < 0) {
    return { name: ref };
  }
  return {
    parent: ref.slice(0, slash),
    name: ref.slice(slash + 1),
  };
}

export function buildFQName(parent: string, name: string): string {
  return `${parent}/${name}`;
}
