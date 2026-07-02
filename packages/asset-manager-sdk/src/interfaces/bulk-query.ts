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

import type { Activity, Address, Asset, Collection, Pool } from './assets.js';
import type { ActivityEvent, Data, Fragment } from './data.js';
import type { NFT, Transfer, BalanceChange } from './nfts.js';

export type SimpleFilterValue = string;

export interface FilterJSONBase {
  not?: boolean;
  caseInsensitive?: boolean;
  field?: string;
}

export interface FilterJSONKeyValue extends FilterJSONBase {
  value?: SimpleFilterValue;
}

export interface FilterJSONKeyValues extends FilterJSONBase {
  values?: SimpleFilterValue[];
}

export interface FilterJSONOps {
  equal?: FilterJSONKeyValue[];
  eq?: FilterJSONKeyValue[];
  neq?: FilterJSONKeyValue[];
  contains?: FilterJSONKeyValue[];
  startsWith?: FilterJSONKeyValue[];
  endsWith?: FilterJSONKeyValue[];
  lessThan?: FilterJSONKeyValue[];
  lt?: FilterJSONKeyValue[];
  lessThanOrEqual?: FilterJSONKeyValue[];
  lte?: FilterJSONKeyValue[];
  greaterThan?: FilterJSONKeyValue[];
  gt?: FilterJSONKeyValue[];
  greaterThanOrEqual?: FilterJSONKeyValue[];
  gte?: FilterJSONKeyValue[];
  in?: FilterJSONKeyValues[];
  nin?: FilterJSONKeyValues[];
  null?: FilterJSONBase[];
}

export interface FilterJSON extends FilterJSONOps {
  or?: FilterJSON[];
}

export interface QueryJSON extends FilterJSON {
  skip?: number;
  limit?: number;
  sort?: string[];
  count?: boolean;
  fields?: string[];
}

export interface DataModelQueryJSON extends QueryJSON {
  labels?: FilterJSONOps;
}

export interface FilterResult<T> {
  count: number;
  total?: number;
  allItems: boolean;
  context?: {
    query?: string;
  };
  items: T[];
}

export interface BulkQueryInput {
  activities?: DataModelQueryJSON;
  addresses?: DataModelQueryJSON;
  assets?: DataModelQueryJSON;
  collections?: DataModelQueryJSON;
  data?: DataModelQueryJSON;
  events?: DataModelQueryJSON;
  fragments?: DataModelQueryJSON;
  nfts?: DataModelQueryJSON;
  pools?: DataModelQueryJSON;
  transfers?: DataModelQueryJSON;
  balanceChanges?: DataModelQueryJSON;
}

export interface BulkQueryOutput {
  activities?: FilterResult<Activity>;
  addresses?: FilterResult<Address>;
  assets?: FilterResult<Asset>;
  collections?: FilterResult<Collection>;
  data?: FilterResult<Data>;
  events?: FilterResult<ActivityEvent>;
  fragments?: FilterResult<Fragment>;
  nfts?: FilterResult<NFT>;
  pools?: FilterResult<Pool>;
  transfers?: FilterResult<Transfer>;
  balanceChanges?: FilterResult<BalanceChange>;
}
