import { newLogger } from "@kaleido-io/workflow-engine-sdk";
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
} from "./asset-manager.interfaces.js";
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
 */
export class BulkUpsertAutoFlush {

  flushedCount: number = 0;

  constructor(
    private builder: BulkUpsertBuilder,
    private readonly flushAt: number,
  ) {}

  private async flushIfNeeded(): Promise<void> {
    if (this.builder.getCount() >= this.flushAt) {
      this.flushedCount += this.builder.getCount();
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
    log.debug(`Flushing ${this.builder.getCount()} updates (total=${this.getTotalCount()})`)
    await this.builder.execute();
  }
}
