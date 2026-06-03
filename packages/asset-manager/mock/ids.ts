// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "crypto";

export type IdGenerator = () => string;

export const uuidIds: IdGenerator = () => randomUUID();

/**
 * Counter-based id generator. Useful for tests that want stable
 * snapshot output. Counters are scoped per call to `counterIds()` so
 * resetting the store with a fresh generator gives reproducible ids.
 *
 * Format: `mock-<kind>-<n>` if the caller passes a kind tag at
 * construction; falls back to `mock-<n>`.
 */
export function counterIds(prefix = "mock"): IdGenerator {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export function nowIso(clock?: () => number): string {
  return new Date(clock ? clock() : Date.now()).toISOString();
}
