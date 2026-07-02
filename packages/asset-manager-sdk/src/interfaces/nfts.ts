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

import type { KldResourceBase, ObjectLabels, DataModelReference, AddressScope } from './common.js';

export interface NFTFFLinks {
  namespace?: string;
}

export interface NFTInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  standard?: string;
  tokenIndex?: string;
  uri?: string;
  active?: boolean;
  firefly?: NFTFFLinks;
  asset?: DataModelReference;
}

export interface NFT
  extends KldResourceBase, NFTInput, ObjectLabels, AddressScope {
  name: string;
  qualifiedName?: string;
}

export interface TransferFFLinks {
  namespace?: string;
  blockchainEvent?: string;
}

export type TransferParentType = "nft" | "pool";

export interface TransferParent {
  type?: TransferParentType;
  ref?: DataModelReference;
}

export type TransferType = "mint" | "burn" | "transfer";

export interface TransferInput {
  protocolId: string;
  displayName?: string;
  description?: string;
  info?: any;
  type?: TransferType;
  signer?: string;
  from?: string;
  to?: string;
  amount?: string;
  firefly?: TransferFFLinks;
  transactionHash: string;
  balanceChanges?: BalanceChangeInput[];
}

export interface Transfer extends KldResourceBase, TransferInput, ObjectLabels {
  asset?: DataModelReference;
  parent?: TransferParent;
}

export type BalanceTransferOp = "add" | "subtract";

export interface BalanceChangeInput {
  address?: string;
  operation?: BalanceTransferOp;
  amount?: string;
}

export interface BalanceChange extends KldResourceBase, BalanceChangeInput {
  asset?: DataModelReference;
  parent?: TransferParent;
  transfer?: string;
  name?: string;
  balanceBefore?: string;
  balanceAfter?: string;
}

export interface Balance {
  id: string;
  address?: string;
  asset?: string;
  pool?: string;
  balanceAfter?: string;
  updated?: string;
}
