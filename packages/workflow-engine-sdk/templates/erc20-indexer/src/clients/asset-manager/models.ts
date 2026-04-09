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

/**
 * Asset Manager data model types for the bulk upsert API.
 *
 * These map to the PUT /api/v1/bulk/datamodel endpoint on the Asset Manager service.
 * See the Kaleido Asset Manager documentation for full field reference.
 *
 * NOTE: This client will be replaced by @kaleido-io/asset-manager-sdk once it
 * is available. Until then, users own this code and can modify it freely.
 */

export type UpdateType = 'create_or_ignore' | 'create_or_replace' | 'create_or_update';

export type Asset = {
  name: string;
  displayName?: string;
  info?: Record<string, unknown>;
  labels?: Record<string, string>;
  updateType?: UpdateType;
};

export type Address = {
  address: string;
  displayName?: string;
  contract?: boolean;
  info?: Record<string, unknown>;
  labels?: Record<string, string>;
  updateType?: UpdateType;
};

export type Pool = {
  name: string;
  asset?: string;
  address: string;
  standard?: string;
  displayName?: string;
  description?: string;
  info?: Record<string, unknown>;
  labels?: Record<string, string>;
  updateType?: UpdateType;
};

export type Fragment = {
  name: string;
  address: string;
  value?: string;
  valueReference?: string;
  asset?: string;
  displayName?: string;
  description?: string;
  info?: Record<string, unknown>;
  labels?: Record<string, string>;
  updateType?: UpdateType;
};

export type BalanceChange = {
  address: string;
  operation: 'add' | 'subtract';
  amount: string;
};

export type Transfer = {
  protocolId: string;
  from?: string;
  to?: string;
  signer?: string;
  amount: string;
  transactionHash: string;
  parent: { type: string; ref: string };
  info?: Record<string, unknown>;
  balanceChanges: BalanceChange[];
  labels?: Record<string, string>;
  updateType?: UpdateType;
};
