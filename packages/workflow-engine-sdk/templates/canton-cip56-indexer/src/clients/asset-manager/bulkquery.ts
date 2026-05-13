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

import type { Asset, Address, Pool, Transfer, Fragment } from './models.js';

/** A single filter condition within a DataModelQuery. */
export type FilterCondition = {
  field: string;
  value?: unknown;
  values?: unknown[];
  caseInsensitive?: boolean;
};

/**
 * Filter/query object for a single data model type.
 * Maps to the ffapi.QueryJSON format used by Asset Manager.
 * Each field present in the request body causes that type to be queried.
 */
export type DataModelQuery = {
  skip?: number;
  limit?: number;
  count?: boolean;
  sort?: string[];
  ascending?: boolean;
  descending?: boolean;
  equal?: FilterCondition[];
  neq?: FilterCondition[];
  contains?: FilterCondition[];
  startsWith?: FilterCondition[];
  endsWith?: FilterCondition[];
  gt?: FilterCondition[];
  gte?: FilterCondition[];
  lt?: FilterCondition[];
  lte?: FilterCondition[];
  in?: FilterCondition[];
  nin?: FilterCondition[];
  null?: FilterCondition[];
  or?: DataModelQuery[];
};

/** Paginated result set returned for a single data model type in a bulk query. */
export type FilterResult<T> = {
  count: number;
  total?: number;
  allItems: boolean;
  context?: { query?: string };
  items: T[];
};

/** Input payload for POST /api/v1/bulk/query */
export type BulkQueryInput = {
  assets?: DataModelQuery;
  addresses?: DataModelQuery;
  pools?: DataModelQuery;
  transfers?: DataModelQuery;
  fragments?: DataModelQuery;
};

/** Response from POST /api/v1/bulk/query */
export type BulkQueryOutput = {
  assets?: FilterResult<Asset>;
  addresses?: FilterResult<Address>;
  pools?: FilterResult<Pool>;
  transfers?: FilterResult<Transfer>;
  fragments?: FilterResult<Fragment>;
};
