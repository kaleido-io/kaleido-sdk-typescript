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
import { newLogger } from "@kaleido-io/core-sdk/log";
import type { BulkModule, ModuleUpsertInput, ModuleSettings } from "./types.js";
import type { BulkUpsertBuilder, DuplicateStrategy, ModuleBuilder } from "./bulk-upsert-builder.js";

const log = newLogger("SubledgerBulkUpsertAutoFlush");

/** Adds to and configures one module of a {@link BulkUpsertAutoFlush}. */
export class AutoFlushModule<M extends BulkModule> {
  constructor(
    private readonly module: ModuleBuilder<M>,
    private readonly flushIfNeeded: () => Promise<void>,
  ) {}

  /** Add upsert input for this module, flushing once the threshold is reached. */
  async add(input: ModuleUpsertInput<M>, duplicates?: DuplicateStrategy): Promise<void> {
    this.module.add(input, duplicates);
    await this.flushIfNeeded();
  }

  /** Override the builder's `defaults` option for sections of this module. */
  configure(settings: ModuleSettings<M>): this {
    this.module.configure(settings);
    return this;
  }
}

/**
 * Wraps a {@link BulkUpsertBuilder} and calls {@link execute} once the
 * accumulated item count reaches `flushAt`. Call {@link execute} at the end of
 * a batch to send any remaining items.
 *
 * Callers must `await` each `add` before the next.
 */
export class BulkUpsertAutoFlush {
  flushedCount = 0;

  readonly registry = new AutoFlushModule(this.builder.registry, () => this.flushIfNeeded());
  readonly accounting = new AutoFlushModule(this.builder.accounting, () => this.flushIfNeeded());
  readonly blockchain = new AutoFlushModule(this.builder.blockchain, () => this.flushIfNeeded());
  readonly token = new AutoFlushModule(this.builder.token, () => this.flushIfNeeded());
  readonly lifecycle = new AutoFlushModule(this.builder.lifecycle, () => this.flushIfNeeded());

  constructor(
    private builder: BulkUpsertBuilder,
    private readonly flushAt: number,
  ) {}

  getTotalCount(): number {
    return this.flushedCount + this.builder.getCount();
  }

  private async flushIfNeeded(): Promise<void> {
    if (this.builder.getCount() >= this.flushAt) {
      await this.execute();
    }
  }

  addFinalizer(finalizer: () => void | Promise<void>): this {
    this.builder.addFinalizer(finalizer);
    return this;
  }

  async execute(): Promise<void> {
    const countToFlush = this.builder.getCount();
    log.debug(`Flushing ${countToFlush} updates (total=${this.getTotalCount()})`);
    await this.builder.execute();
    this.flushedCount += countToFlush;
  }
}
