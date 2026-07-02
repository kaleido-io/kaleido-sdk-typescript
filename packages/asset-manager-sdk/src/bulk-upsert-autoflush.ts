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
import { newLogger } from '@kaleido-io/core-sdk/log';
import {
  ActivityBulkInput,
  AddressBulkInput,
  AssetBulkInput,
  CollectionBulkInput,
  DataBulkInput,
  EventBulkInput,
  FragmentBulkInput,
  NFTBulkInput,
  PoolBulkInput,
  TransferBulkInput,
} from "./interfaces/index.js";
import {
  BulkUpsertBuilder,
  DuplicateStrategy
} from "./bulk-upsert-builder.js";

const log = newLogger("BulkUpsertAutoFlush");

/**
 * Wraps a {@link BulkUpsertBuilder} and automatically calls {@link execute}
 * once the accumulated item count reaches `flushAt`. Each `upsert*` method
 * is async so callers can await the implicit flush.
 *
 * Call {@link execute} at the end of a batch to flush any remaining items.
 *
 * Not safe for concurrent use: callers must `await` each `upsert*` before the
 * next. Issuing several without awaiting can let multiple pass the threshold
 * check and double-flush, and the flushedCount/getTotalCount arithmetic assumes
 * serial execution.
 */
export class BulkUpsertAutoFlush {

  flushedCount: number = 0;

  constructor(
    private builder: BulkUpsertBuilder,
    private readonly flushAt: number,
  ) {}

  private async flushIfNeeded(): Promise<void> {
    if (this.builder.getCount() >= this.flushAt) {
      await this.execute();
    }
  }

  getTotalCount(): number {
    return this.flushedCount + this.builder.getCount();
  }

  async upsertAsset(asset: AssetBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertAsset(asset, duplicates);
    await this.flushIfNeeded();
  }

  async upsertActivity(activity: ActivityBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertActivity(activity, duplicates);
    await this.flushIfNeeded();
  }

  async upsertCollection(collection: CollectionBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertCollection(collection, duplicates);
    await this.flushIfNeeded();
  }

  async upsertEvent(event: EventBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertEvent(event, duplicates);
    await this.flushIfNeeded();
  }

  async upsertAddress(address: AddressBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertAddress(address, duplicates);
    await this.flushIfNeeded();
  }

  async upsertData(data: DataBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertData(data, duplicates);
    await this.flushIfNeeded();
  }

  async upsertPool(pool: PoolBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertPool(pool, duplicates);
    await this.flushIfNeeded();
  }

  async upsertTransfer(transfer: TransferBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertTransfer(transfer, duplicates);
    await this.flushIfNeeded();
  }

  async upsertFragment(fragment: FragmentBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertFragment(fragment, duplicates);
    await this.flushIfNeeded();
  }

  async upsertNFT(nft: NFTBulkInput, duplicates?: DuplicateStrategy): Promise<void> {
    this.builder.upsertNFT(nft, duplicates);
    await this.flushIfNeeded();
  }

  addFinalizer(finalizer: () => void | Promise<void>): this {
    this.builder.addFinalizer(finalizer);
    return this;
  }

  async execute(): Promise<void> {
    const countToFlush = this.builder.getCount();
    log.debug(`Flushing ${countToFlush} updates (total=${this.getTotalCount()})`)
    await this.builder.execute();
    this.flushedCount += countToFlush;
  }
}
