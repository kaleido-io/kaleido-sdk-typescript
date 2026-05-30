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

import type {
  Address,
  BulkQueryInput,
  BulkQueryOutput,
  Fragment,
  FragmentBulkInput,
  IDataModelClient,
  IndexerConfig,
  TransferBulkInput
} from '@kaleido-io/asset-manager-sdk';
import { BulkUpsertBuilder, Indexer } from '@kaleido-io/asset-manager-sdk';
import {
  EventProcessorEvent,
  newLogger,
  RequestContext
} from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEvent } from '@kaleido-io/workflow-engine-sdk/types/evm';
import { ETHIndexerConfig } from './config.js';

const log = newLogger('eth-indexer');

export class ETHIndexer extends Indexer<ETHIndexerConfig, any> {
  private chainId!: number;
  private tokenName!: string;
  private networkName!: string;
  private upsertTriggerCount: number;
  private bulkQueryLimit: number;

  constructor(config: IndexerConfig<ETHIndexerConfig>) {
    super(config);
    this.bulkQueryLimit = config.config?.bulkQueryLimit || 100;
    this.upsertTriggerCount = config.config?.upsertTriggerCount || 500;
  }

  override async setup(
    ethConfig: ETHIndexerConfig,
    dmClient: IDataModelClient,
  ): Promise<void> {
    this.networkName = ethConfig.networkName;
    this.chainId = Number(ethConfig.chainId);
    this.tokenName = ethConfig.tokenName.toLowerCase();

    const symbol = ethConfig.tokenSymbol ?? this.tokenName;

    const builder = new BulkUpsertBuilder(dmClient);
    builder.upsertAsset({ name: this.tokenName, displayName: this.tokenName, info: { symbol }, updateType: 'create_or_ignore' });
    builder.upsertAddress({ address: this.tokenName, contract: true, updateType: 'create_or_ignore' });
    builder.upsertPool({
      updateType: 'create_or_ignore',
      name: this.tokenName,
      asset: this.tokenName,
      address: this.tokenName,
      standard: 'eth',
      displayName: `${this.tokenName} on ${this.networkName}`,
      labels: { networkName: this.networkName, symbol },
    });
    await builder.execute();
  }

  override async indexBatch(
    reqContext: RequestContext,
    events: EventProcessorEvent<EVMTransactionEvent>[],
    dmClient: IDataModelClient,
  ): Promise<{
    events: EventProcessorEvent<EVMTransactionEvent>[];
  }> {
    if (events.length === 0) {
      return { events };
    }

    const builder = new BulkUpsertBuilder(dmClient, { reqContext }).autoFlush(this.upsertTriggerCount);
    const startTime = Date.now();
    log.info(`Received batch of ${events.length} events`);

    let txCount = 0;
    for (const event of events) {
      const { block, chainId, receipt, transactionHash } = event.data;
      if (this.chainId !== Number(chainId)) {
        throw new Error(
          `Network mismatch configured=${this.chainId} event=${chainId}`,
        );
      }

      txCount++;
      log.debug(`Indexing TX ${transactionHash} in block ${block.number}`);
      for (const ethTransfer of event.data.ethTransfer || []) {
        const transfer: TransferBulkInput = {
          updateType: 'create_or_ignore',
          protocolId: transactionHash,
          info: receipt,
          amount: ethTransfer.value,
          transactionHash: transactionHash,
          from: ethTransfer.from,
          to: ethTransfer.to,
          balanceChanges: [
            {
              address: `${this.tokenName}_${ethTransfer.from}`,
              amount: ethTransfer.value,
              operation: 'subtract',
            },
            {
              address: `${this.tokenName}_${ethTransfer.to}`,
              amount: ethTransfer.value,
              operation: 'add',
            }
          ],
          parent: { type: 'pool', ref: `${this.tokenName}/${this.tokenName}` },
        }
        await builder.upsertTransfer(transfer)
      }      
    }

    // Flush the remainder
    await builder.execute();

    log.info(`Indexed ${txCount} transactions with a total of ${builder.getTotalCount()} updates in ${Date.now() - startTime}ms`);
    return { events };
  }
}
