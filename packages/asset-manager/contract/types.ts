// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type { AssetManagerClient } from "../src/asset-manager.js";

export interface ContractContext {
  /** Fresh client per scenario (isolated store / namespace). */
  createClient: () => AssetManagerClient;
  /** Human-readable backend label for failure messages. */
  backend: "mock" | "real";
}

export type ContractRegistrar = (ctx: ContractContext) => void;
