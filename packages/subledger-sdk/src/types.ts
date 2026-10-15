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
import type { BulkUpsertInput } from "./schema.js";

/** A top-level group of the bulk body: registry, accounting, blockchain, token or lifecycle. */
export type BulkModule = keyof BulkUpsertInput;

type ModuleInput<M extends BulkModule> = NonNullable<BulkUpsertInput[M]>;

/** A collection within a module's bulk upsert body. */
export type SectionOf<M extends BulkModule> = keyof ModuleInput<M> & string;

type SectionValue<M extends BulkModule, S extends SectionOf<M>> = NonNullable<ModuleInput<M>[S]>;

/** One section entry: a single object for unscoped sections, one array element for scoped ones. */
export type SectionEntry<M extends BulkModule, S extends SectionOf<M>> =
  SectionValue<M, S> extends unknown[] ? SectionValue<M, S>[number] : SectionValue<M, S>;

/** The item type a section accepts. */
export type ItemOf<M extends BulkModule, S extends SectionOf<M>> =
  SectionEntry<M, S> extends { items: (infer I)[] } ? I : never;

/**
 * The settings of one section entry. Every section carries the same three;
 * `registry.assets` is an arbitrary one to read them from.
 */
export type SectionSettings = Pick<
  SectionEntry<"registry", "assets">,
  "updateStrategy" | "labelStrategy" | "options"
>;

export type UpdateStrategy = SectionSettings["updateStrategy"];
export type LabelStrategy = NonNullable<SectionSettings["labelStrategy"]>;

type WithoutSettings<T> = T extends unknown[]
  ? Omit<T[number], keyof SectionSettings>[]
  : Omit<T, keyof SectionSettings>;

/** A module's upsert input: its part of the bulk upsert body, without section settings. */
export type ModuleUpsertInput<M extends BulkModule> = {
  [S in SectionOf<M>]?: WithoutSettings<SectionValue<M, S>>;
};

/** Per-section settings for a module; each field given overrides the builder's `defaults` option. */
export type ModuleSettings<M extends BulkModule> = {
  [S in SectionOf<M>]?: Partial<SectionSettings>;
};
