// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import type { BulkModule, ItemOf, SectionOf } from "./types.js";

/** The root field of each module's scoped sections. */
export const ROOT_FIELD: Record<BulkModule, string | undefined> = {
  registry: undefined,
  accounting: "bookUrn",
  blockchain: "chainUrn",
  token: "tokenUrn",
  lifecycle: "transactionTypeUrn",
};

/**
 * Fields that uniquely identify an item (not including its scoped root).
 * Used for identifying duplicate items.
 */
export const IDENTITY: {
  [M in BulkModule]: {
    [S in SectionOf<M>]: (keyof ItemOf<M, S> & string)[];
  };
} = {
  registry: {
    assets: ["name"],
    contracts: ["name"],
    parties: ["parentPartyUrn", "name"],
    wallets: ["parentWalletUrn", "name"],
    assetIdentifiers: ["value"],
    contractIdentifiers: ["value"],
    partyIdentifiers: ["value"],
    walletIdentifiers: ["value"],
  },
  accounting: {
    accounts: ["parentAccountUrn", "name"],
    books: ["name"],
    holds: ["name"],
    holdReleases: ["holdUrn"],
    journalEntries: ["name"],
    walletAssignments: ["name"],
    walletUnassignments: ["walletAssignmentUrn"],
  },
  blockchain: {
    accounts: ["name"],
    blocks: ["name"],
    chains: ["name"],
    deployments: ["name"],
    events: ["transactionUrn", "name"],
    states: ["name"],
    stateArchivals: ["stateUrn"],
    transactions: ["name"],
  },
  token: {
    coins: ["name"],
    coinSpends: ["coinUrn"],
    locks: ["name"],
    lockReleases: ["lockUrn"],
    tokens: ["name"],
    transfers: ["name"],
  },
  lifecycle: {
    conditions: ["transactionUrn", "name"],
    legs: ["transactionUrn", "name"],
    signals: ["idempotencyKey"],
    steps: ["transactionUrn", "name"],
    stepStarts: ["stepUrn"],
    stepOutcomes: ["stepUrn"],
    transactions: ["name"],
    transactionOutcomes: ["transactionUrn"],
    transactionTypes: ["name"],
  },
};
