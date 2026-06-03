// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Public entry for the Asset Manager SDK mock. See `am-mock-plan.md`
 * at the repo root for design notes.
 *
 * Consumers:
 *   import { MockAssetManagerClient } from '@kaleido-io/asset-manager-sdk/mock';
 */

export {
  MockAssetManagerClient,
  type MockAssetManagerClientOptions,
} from "./mock-client.js";

export {
  AssetManagerStore,
  type MockAssetManagerStoreOptions,
} from "./store.js";

export {
  type EventBatchDelivery,
  type SubscriptionCallback,
} from "./events.js";

export {
  counterIds,
  uuidIds,
  type IdGenerator,
} from "./ids.js";

export {
  MockAssetManagerError,
} from "./errors.js";

export type { ResourceKind } from "./descriptors.js";
