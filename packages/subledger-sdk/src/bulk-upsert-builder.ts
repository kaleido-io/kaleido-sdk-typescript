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
import { AxiosRequestConfig } from "axios";
import deepmerge from "deepmerge";
import { BulkUpsertAutoFlush } from "./bulk-upsert-autoflush.js";
import { IDENTITY, ROOT_FIELD } from "./model.js";
import type { BulkUpsertInput, BulkUpsertOutput } from "./schema.js";
import type { BulkModule, ModuleSettings, ModuleUpsertInput, SectionSettings } from "./types.js";

export interface IBulkUpsertClient {
  bulkUpsert(input: BulkUpsertInput, options?: AxiosRequestConfig): Promise<BulkUpsertOutput>;
}

/**
 * How an add treats an earlier item for the same row in the same builder.
 * A bulk body may name each row at most once.
 */
export enum DuplicateStrategy {
  MERGE = 0, // Deep merge with any previous update to the same item (default)
  SKIP = 1, // Only add this update if one doesn't already exist in the list
  REPLACE = 2, // Replace any previous update to the same item
}

export interface BulkUpsertBuilderOptions {
  /** Settings for every section not overridden by `configure`. */
  defaults: SectionSettings;
  /** Abort signal for the bulk upsert request. */
  signal?: AbortSignal;
}

type Item = Record<string, unknown>;

/** A section entry as received: its items, plus its root field when scoped. */
type Entry = { items: Item[]; [field: string]: unknown };

interface Section {
  module: BulkModule;
  section: string;
  root?: string;
  items: Map<string, Item>;
}

/** Adds to and configures one module of a {@link BulkUpsertBuilder}. */
export class ModuleBuilder<M extends BulkModule> {
  constructor(
    private readonly addFn: (input: ModuleUpsertInput<M>, duplicates?: DuplicateStrategy) => void,
    private readonly configureFn: (settings: ModuleSettings<M>) => void,
  ) {}

  /** Add upsert input for this module. `duplicates` applies to every item in it. */
  add(input: ModuleUpsertInput<M>, duplicates?: DuplicateStrategy): this {
    this.addFn(input, duplicates);
    return this;
  }

  /** Override the builder's `defaults` option for sections of this module. */
  configure(settings: ModuleSettings<M>): this {
    this.configureFn(settings);
    return this;
  }
}

/**
 * Accumulates subledger writes and sends them as one bulk upsert, with each
 * row named at most once.
 */
export class BulkUpsertBuilder {
  readonly registry = this.moduleBuilder("registry");
  readonly accounting = this.moduleBuilder("accounting");
  readonly blockchain = this.moduleBuilder("blockchain");
  readonly token = this.moduleBuilder("token");
  readonly lifecycle = this.moduleBuilder("lifecycle");

  private sections = new Map<string, Section>();
  private configured = new Map<string, Partial<SectionSettings>>();
  private finalizers: (() => void | Promise<void>)[] = [];
  private count = 0;

  constructor(
    private client: IBulkUpsertClient,
    private options: BulkUpsertBuilderOptions,
  ) {}

  autoFlush(flushAt: number): BulkUpsertAutoFlush {
    return new BulkUpsertAutoFlush(this, flushAt);
  }

  hasUpdates(): boolean {
    return this.count > 0;
  }

  getCount(): number {
    return this.count;
  }

  addFinalizer(finalizer: () => void | Promise<void>): this {
    this.finalizers.push(finalizer);
    return this;
  }

  /** Build the bulk body for the accumulated items. */
  toBulkUpsert(): BulkUpsertInput {
    const body: Record<string, Record<string, unknown>> = {};
    for (const s of this.sections.values()) {
      const settings = this.settingsFor(s.module, s.section);
      const entry: Record<string, unknown> = {
        updateStrategy: settings.updateStrategy,
        labelStrategy: settings.labelStrategy,
        options: settings.options,
        items: [...s.items.values()],
      };

      const moduleBody = (body[s.module] ??= {});
      if (s.root === undefined) {
        moduleBody[s.section] = entry;
      } else {
        entry[ROOT_FIELD[s.module]!] = s.root;
        const entries = (moduleBody[s.section] ??= []) as unknown[];
        entries.push(entry);
      }
    }
    return body as BulkUpsertInput;
  }

  /**
   * Sends the accumulated items, then runs the finalizers. Returns `undefined`
   * when there was nothing to send.
   *
   * Items and finalizers are cleared whether the upsert succeeds or throws;
   * defaults and `configure` settings are kept.
   */
  async execute(): Promise<BulkUpsertOutput | undefined> {
    try {
      const result = this.hasUpdates()
        ? await this.client.bulkUpsert(this.toBulkUpsert(), { signal: this.options.signal })
        : undefined;
      await Promise.all(this.finalizers.map((f) => Promise.resolve(f())));
      return result;
    } finally {
      this.sections.clear();
      this.finalizers = [];
      this.count = 0;
    }
  }

  private moduleBuilder<M extends BulkModule>(module: M): ModuleBuilder<M> {
    return new ModuleBuilder<M>(
      (input, duplicates) => this.addInput(module, input, duplicates),
      (settings) => this.configureModule(module, settings),
    );
  }

  /** Add each section entry's items to the section for its root. */
  private addInput(module: BulkModule, input: object, duplicates?: DuplicateStrategy): void {
    const rootField = ROOT_FIELD[module];
    for (const [section, value] of Object.entries(input) as [
      string,
      Entry | Entry[] | undefined,
    ][]) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          this.addEntry(module, section, entry[rootField!] as string, entry.items, duplicates);
        }
      } else if (value) {
        this.addEntry(module, section, undefined, value.items, duplicates);
      }
    }
  }

  /** Add an entry's items to the section for its root. */
  private addEntry(
    module: BulkModule,
    section: string,
    root: string | undefined,
    items: Item[],
    duplicates?: DuplicateStrategy,
  ): void {
    const target = this.sectionFor(module, section, root);
    for (const item of items) {
      this.addItem(target, item, duplicates);
    }
  }

  /** Add an item to its section, combining it with an earlier item for the same row per `duplicates`. */
  private addItem(target: Section, item: Item, duplicates?: DuplicateStrategy): void {
    const key = itemKey(target.module, target.section, item);
    const existing = target.items.get(key);
    if (existing === undefined) {
      target.items.set(key, item);
      this.count++;
    } else if (duplicates === DuplicateStrategy.REPLACE) {
      target.items.set(key, item);
    } else if (duplicates !== DuplicateStrategy.SKIP) {
      target.items.set(key, deepmerge(existing, item));
    }
  }

  private configureModule(
    module: BulkModule,
    settings: { [section: string]: Partial<SectionSettings> | undefined },
  ): void {
    for (const [section, update] of Object.entries(settings)) {
      const id = `${module}.${section}`;
      const current: Partial<SectionSettings> = { ...this.configured.get(id) };
      for (const field of ["updateStrategy", "labelStrategy", "options"] as const) {
        const value = update?.[field];
        if (value === undefined) {
          continue;
        }
        if (
          current[field] !== undefined &&
          JSON.stringify(current[field]) !== JSON.stringify(value)
        ) {
          throw new Error(`Conflicting ${field} for ${id}`);
        }
        Object.assign(current, { [field]: value });
      }
      this.configured.set(id, current);
    }
  }

  private settingsFor(module: BulkModule, section: string): SectionSettings {
    return { ...this.options.defaults, ...this.configured.get(`${module}.${section}`) };
  }

  private sectionFor(module: BulkModule, section: string, root: Section["root"]): Section {
    const id = JSON.stringify([module, section, root ?? null]);
    let target = this.sections.get(id);
    if (!target) {
      target = { module, section, root, items: new Map() };
      this.sections.set(id, target);
    }
    return target;
  }
}

function itemKey(module: BulkModule, section: string, item: Item): string {
  const fields = (IDENTITY[module] as Record<string, string[]>)[section];
  return JSON.stringify(fields.map((f) => item[f] ?? null));
}
