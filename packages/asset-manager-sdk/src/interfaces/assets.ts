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

import type { KldResourceBase, ObjectLabels, DataModelReference } from './common.js';

export interface AssetInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  collection?: DataModelReference;
}

export interface Asset extends KldResourceBase, AssetInput, ObjectLabels {
  name: string;
}

export interface AddressInput {
  address?: string;
  displayName?: string;
  description?: string;
  info?: any;
  contract?: boolean;
  contractManager?: {
    service?: string;
    build?: string;
  };
  firefly?: {
    namespace?: string;
    api?: string;
  };
}

export interface Address extends AddressInput, ObjectLabels {
  address: string;
  created?: string;
  updated?: string;
}

export interface PoolInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  standard?: string;
  firefly?: {
    namespace?: string;
    api?: string;
  };
  asset?: DataModelReference;
  address?: string;
}

export interface Pool extends KldResourceBase, PoolInput, ObjectLabels {
  name: string;
  qualifiedName?: string;
}

export interface CollectionInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
}

export interface Collection
  extends KldResourceBase, CollectionInput, ObjectLabels {
  name: string;
}

export interface ActivityInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
}

export interface Activity extends KldResourceBase, ActivityInput, ObjectLabels {
  name: string;
}
