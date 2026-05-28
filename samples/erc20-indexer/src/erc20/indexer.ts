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

import {
  BulkUpsertBuilder,
  IDataModelClient,
  Indexer,
  IndexerConfig,
} from '@kaleido-io/asset-manager-sdk';
import {
  EventProcessorEvent,
  newLogger,
} from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEvent } from '@kaleido-io/workflow-engine-sdk/types/evm';
import type { ERC20Config } from '../config/provider-config.js';

const log = newLogger('erc20-indexer');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_SIG = 'Transfer(address,address,uint256)';

/** ABI-decoded fields from a Transfer(address,address,uint256) log event */
type ERC20TransferData = { from: string; to: string; value: string };

/**
 * ERC20 Transfer event processor.
 *
 * Receives decoded EVM transaction batches from a WFE `evmTransactions` stream,
 * maps Transfer(address,address,uint256) events to Asset Manager data models,
 * and bulk-upserts addresses + transfers into the Asset Manager.
 *
 * Call `setup()` once before registering with the WFE client to create the
 * asset and pool definitions in the Asset Manager.
 */
export class ERC20Indexer extends Indexer<ERC20Config, EVMTransactionEvent> {
  private contractAddress!: string;
  private contractName!: string;
  private chain!: string;
  private poolName!: string;

  constructor(config: IndexerConfig<ERC20Config>) {
    super(config);
  }

  /**
   * One-time setup: register the asset and pool in Asset Manager.
   * Must be called before the processor starts receiving batches.
   */
  override async setup(erc20Config: ERC20Config, dmClient: IDataModelClient): Promise<void> {
    this.contractAddress = (erc20Config.contractAddress ?? '').toLowerCase();
    this.contractName = erc20Config.contractName ?? 'ERC20';
    this.chain = erc20Config.chain ?? 'ethereum';
    this.poolName = this.contractName.toLowerCase();

    const symbol = erc20Config.contractSymbol ?? this.contractName;
    const assetName = `${this.contractName.toLowerCase()}_${this.contractAddress.toLowerCase()}`;

    const builder = new BulkUpsertBuilder(dmClient);
    builder.upsertAsset({ name: assetName, displayName: this.contractName, info: { symbol, contractAddress: this.contractAddress }, updateType: 'create_or_ignore' });
    builder.upsertAddress({ address: this.contractAddress, contract: true, updateType: 'create_or_ignore' });
    builder.upsertPool({ name: this.poolName, asset: assetName, address: this.contractAddress, standard: 'ERC20', displayName: `${this.contractName} on ${this.chain}`, labels: { chain: this.chain, symbol }, updateType: 'create_or_ignore' });
    await builder.execute();
  }

  override async indexBatch(
    events: EventProcessorEvent<EVMTransactionEvent>[],
    dmClient: IDataModelClient,
  ): Promise<{ events: EventProcessorEvent<EVMTransactionEvent>[] }> {
    const builder = new BulkUpsertBuilder(dmClient);
    let highestBlock = 0;
    let transferCount = 0;

    log.info(`Received batch of ${events.length} events`);

    for (const event of events) {
      const tx = event.data;
      if (!tx.decodedEvents) continue;

      const blockNumber = parseInt(tx.block.number, 10);
      if (blockNumber > highestBlock) {
        highestBlock = blockNumber;
      }

      for (const decoded of tx.decodedEvents) {
        // These are safety guards to prevent processing events that are not Transfer(address,address,uint256) events
        // nor events for the contract address we are interested in. It could be a misconfiguration in your stream if you
        // see this warning, but if you feel confident that your stream is configured correctly, please reach out
        // to the Kaleido team for support.
        if (decoded.signature !== TRANSFER_SIG) {
          log.warn(`skipping event with signature ${decoded.signature} not matching ${TRANSFER_SIG}`);
          continue;
        }
        if (decoded.address.toLowerCase() !== this.contractAddress) {
          log.warn(`skipping event with address ${decoded.address} not matching ${this.contractAddress}`);
          continue;
        }

        const { from, to, value } = decoded.data as ERC20TransferData;
        const isMint = from === ZERO_ADDRESS;
        const isBurn = to === ZERO_ADDRESS;
        const contractAddr = decoded.address.toLowerCase();

        if (!isMint) builder.upsertAddress({ address: from.toLowerCase(), updateType: 'create_or_ignore' });
        if (!isBurn) builder.upsertAddress({ address: to.toLowerCase(), updateType: 'create_or_ignore' });
        builder.upsertAddress({ address: contractAddr, contract: true, updateType: 'create_or_ignore' });

        // Balance deltas: subtract from sender, add to receiver.
        // Mints/burns update a virtual "circulation" address for total supply tracking.
        const balanceChanges = [];
        if (!isMint) balanceChanges.push({ address: from, operation: 'subtract' as const, amount: String(value) });
        if (!isBurn) balanceChanges.push({ address: to, operation: 'add' as const, amount: String(value) });
        if (isMint)  balanceChanges.push({ address: 'circulation', operation: 'add' as const, amount: String(value) });
        if (isBurn)  balanceChanges.push({ address: 'circulation', operation: 'subtract' as const, amount: String(value) });

        transferCount++;
        builder.upsertTransfer({
          protocolId: `${tx.block.number}/${tx.transactionHash}/${decoded.logIndex}`,
          from: isMint ? undefined : from,
          to: isBurn ? undefined : to,
          signer: tx.receipt?.from,
          amount: String(value),
          transactionHash: tx.transactionHash,
          parent: { type: 'pool', ref: `${contractAddr}/${this.poolName}` },
          info: {
            blockNumber: tx.block.number,
            blockTimestamp: tx.block.timestamp,
            logIndex: decoded.logIndex,
          },
          balanceChanges,
          labels: { chain: this.chain },
          updateType: 'create_or_replace',
        });
      }
    }

    if (transferCount > 0) {
      log.info(`Upserting ${transferCount} transfer(s) up to block ${highestBlock}`);
    } else {
      log.info(`No matching Transfer events in batch (highest block ${highestBlock})`);
    }

    await builder.execute();

    return { events };
  }
}
