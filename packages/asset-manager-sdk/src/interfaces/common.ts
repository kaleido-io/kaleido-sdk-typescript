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

export interface KldResourceBase {
  id: string;
  created?: string;
  updated?: string;
}

export interface NameAndID {
  name: string;
  id?: string;
  parent?: DataModelReference;
}

export type DataModelReference = string;

export interface ObjectLabels {
  labels?: Record<string, string>;
}

export interface AddressScope {
  address?: string;
}

export interface ItemsResult<T> {
  count: number;
  total?: number;
  items: T[];
}

export type UpdateType =
  | "create_only"
  | "update_only"
  | "create_or_replace"
  | "create_or_update"
  | "create_or_ignore";
