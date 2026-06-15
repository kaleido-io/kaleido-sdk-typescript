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
  EventProcessorEvent,
  IndexerContext,

  SetupContext,
} from '@kaleido-io/workflow-engine-sdk';
import { newLogger } from '@kaleido-io/workflow-engine-sdk';
import type { TransferBulkInput } from '@kaleido-io/asset-manager-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import type { EVMTransactionEvent } from '@kaleido-io/connector-sdk/evm';
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import type { ETHIndexerConfig } from './config.js';

const log = newLogger('native-eth-indexer');

export class ETHIndexer {
  private chainId!: number;
  private tokenName!: string;
  private networkName!: string;
  private upsertTriggerCount: number = 500;

  async setup(ctx: SetupContext<ETHIndexerConfig>): Promise<void> {
    const ethConfig = ctx.config;
    this.networkName = ethConfig.networkName;
    this.chainId = Number(ethConfig.chainId);
    this.tokenName = ethConfig.tokenName.toLowerCase();
    this.upsertTriggerCount = ethConfig.upsertTriggerCount ?? 500;

    const symbol = ethConfig.tokenSymbol ?? this.tokenName;

    const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder();
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

    if (ctx.config.stream) {
      await new EVMConnectorClient(ctx.config.stream.connectorBindingName).ensureStream(ctx, {
        factory: ctx.config.stream.factory,
        name: ctx.config.stream.name,
        description: ctx.config.stream.description,
        eventSourceConfig: ctx.config.stream.eventSourceConfig,
      });
    }
  }

  async indexBatch(
    ctx: IndexerContext<ETHIndexerConfig>,
    events: EventProcessorEvent<EVMTransactionEvent>[],
  ): Promise<void> {
    if (events.length === 0) return;

    const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder().autoFlush(this.upsertTriggerCount);
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

      for (const ethTransfer of event.data.ethTransfers || []) {
        const transfer: TransferBulkInput = {
          updateType: 'create_or_ignore',
          protocolId: transactionHash,
          info: receipt,
          amount: ethTransfer.value,
          transactionHash,
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
            },
          ],
          parent: { type: 'pool', ref: `${this.tokenName}/${this.tokenName}` },
        };
        await builder.upsertTransfer(transfer);
      }
    }

    await builder.execute();

    log.info(`Indexed ${txCount} transactions with a total of ${builder.getTotalCount()} updates in ${Date.now() - startTime}ms`);
  }

}
