// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, jest } from "@jest/globals";
import { AssetManagerClient } from "../../src/asset-manager.js";
import type { ContractContext } from "../types.js";
import { registerBulkUpsertScenarios } from "../scenarios/bulk-upsert.js";
import { registerBalanceScenarios } from "../scenarios/balances.js";
import { registerBulkQueryScenarios } from "../scenarios/bulk-query.js";
import { registerSubscriptionScenarios } from "../scenarios/subscriptions.js";
import { registerCascadeDeleteScenarios } from "../scenarios/cascade-delete.js";

/** Real AM HTTP calls can exceed Jest's default 5s per test. */
jest.setTimeout(0);

const amUrl = process.env.AM_CONTRACT_URL;
const describeIntegration = amUrl ? describe : describe.skip;

describeIntegration("AssetManager contract [real]", () => {
  const ctx: ContractContext = {
    backend: "real",
    createClient: () =>
      new AssetManagerClient({
        transport: "http",
        url: amUrl!,
        auth: {
          type: "basic",
          username: process.env.AM_USER ?? "",
          password: process.env.AM_PASS ?? "",
        },
      }),
  };

  registerBulkUpsertScenarios(ctx);
  registerBalanceScenarios(ctx);
  registerBulkQueryScenarios(ctx);
  registerSubscriptionScenarios(ctx);
  registerCascadeDeleteScenarios(ctx);
});
