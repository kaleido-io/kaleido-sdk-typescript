// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe } from "@jest/globals";
import type { AssetManagerClient } from "../../src/asset-manager.js";
import type { MockAssetManagerClient } from "../../mock/mock-client.js";
import { MockAssetManagerClient as MockClient } from "../../mock/mock-client.js";
import { counterIds } from "../../mock/ids.js";
import type { ContractContext } from "../types.js";
import { registerBulkUpsertScenarios } from "../scenarios/bulk-upsert.js";
import { registerBalanceScenarios } from "../scenarios/balances.js";
import { registerBulkQueryScenarios } from "../scenarios/bulk-query.js";
import { registerSubscriptionScenarios } from "../scenarios/subscriptions.js";
import { registerCascadeDeleteScenarios } from "../scenarios/cascade-delete.js";

/** Compile-time guard: mock must remain assignable to AssetManagerClient. */
type _AssertMockExtendsClient = MockAssetManagerClient extends AssetManagerClient
  ? true
  : never;

const ctx: ContractContext = {
  backend: "mock",
  createClient: () => new MockClient({ idGenerator: counterIds("k") }),
};

describe("AssetManager contract [mock]", () => {
  registerBulkUpsertScenarios(ctx);
  registerBalanceScenarios(ctx);
  registerBulkQueryScenarios(ctx);
  registerSubscriptionScenarios(ctx);
  registerCascadeDeleteScenarios(ctx);
});
