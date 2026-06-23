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

export type DataParentType =
  | "none"
  | "address"
  | "asset"
  | "collection"
  | "nft"
  | "pool"
  | "fragment";

export interface DataParent {
  type?: DataParentType;
  ref?: DataModelReference;
}

export interface DataFFLinks {
  namespace?: string;
  data?: string;
}

export interface DataInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  uri?: string;
  transactionHash?: string;
  role?: string;
  firefly?: DataFFLinks;
  parent?: DataParent;
}

export interface Data extends KldResourceBase, DataInput, ObjectLabels {
  name: string;
  asset?: DataModelReference;
}

export type EventParentType =
  | "none"
  | "address"
  | "asset"
  | "collection"
  | "nft"
  | "pool"
  | "fragment"
  | "data";

export interface EventParent {
  type?: EventParentType;
  ref?: DataModelReference;
}

export interface EventInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  parent?: EventParent;
}

export interface ActivityEvent
  extends KldResourceBase, EventInput, ObjectLabels {
  name: string;
  topic?: string;
  sequence?: number;
  activity?: DataModelReference;
  asset?: DataModelReference;
}

export interface FragmentInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  value?: string;
  valueMasked?: boolean;
  valueReference?: string;
  asset?: DataModelReference;
}

export interface Fragment
  extends KldResourceBase, FragmentInput, ObjectLabels, AddressScope {
  name: string;
  qualifiedName?: string;
}
