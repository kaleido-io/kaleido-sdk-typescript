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

import type { UpdateType, ObjectLabels, NameAndID } from './common.js';
import type { AddressInput, AssetInput, PoolInput, ActivityInput, CollectionInput } from './assets.js';
import type { DataInput, EventInput, FragmentInput, DataParent } from './data.js';
import type { NFTInput, TransferInput, TransferParent } from './nfts.js';

export interface UpsertManyResult {
  created?: NameAndID[];
  replaced?: NameAndID[];
  updated?: NameAndID[];
  ignored?: NameAndID[];
}

export interface AddressBulkInput extends AddressInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface AssetBulkInput extends AssetInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface PoolBulkInput extends Omit<PoolInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface ActivityBulkInput extends ActivityInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface CollectionBulkInput extends CollectionInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface DataBulkInput extends DataInput, ObjectLabels {
  updateType?: UpdateType;
  parent?: DataParent;
}

export interface EventBulkInput extends EventInput, ObjectLabels {
  updateType?: UpdateType;
  activity: string;
}

export interface FragmentBulkInput
  extends Omit<FragmentInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface NFTBulkInput extends Omit<NFTInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface TransferBulkInput extends TransferInput, ObjectLabels {
  updateType?: UpdateType;
  parent: TransferParent;
}

export interface BulkUpsertInput {
  activities?: ActivityBulkInput[];
  addresses?: AddressBulkInput[];
  assets?: AssetBulkInput[];
  collections?: CollectionBulkInput[];
  data?: DataBulkInput[];
  events?: EventBulkInput[];
  fragments?: FragmentBulkInput[];
  nfts?: NFTBulkInput[];
  pools?: PoolBulkInput[];
  transfers?: TransferBulkInput[];
}

export interface BulkUpsertOutput {
  activities?: UpsertManyResult;
  addresses?: UpsertManyResult;
  assets?: UpsertManyResult;
  collections?: UpsertManyResult;
  data?: UpsertManyResult;
  events?: UpsertManyResult;
  fragments?: UpsertManyResult;
  nfts?: UpsertManyResult;
  pools?: UpsertManyResult;
  transfers?: UpsertManyResult;
}
