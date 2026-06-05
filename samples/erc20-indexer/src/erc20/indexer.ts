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
  EventProcessorEvent,
  IndexerContext,
  IndexerHandlerDef,
  ensureStream,
  newLogger,
} from '@kaleido-io/sdk';
import type { EVMTransactionEvent } from '@kaleido-io/sdk/types/evm';
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
 */
export class ERC20Indexer {
  async setup(ctx: IndexerContext<ERC20Config>): Promise<void> {
    const { contractAddress, contractName, contractSymbol, chain, stream } = ctx.config;
    const addr = (contractAddress ?? '').toLowerCase();
    const name = contractName ?? 'ERC20';
    const symbol = contractSymbol ?? name;
    const chainLabel = chain ?? 'ethereum';
    const poolName = name.toLowerCase();
    const assetName = `${name.toLowerCase()}_${addr}`;

    const builder = new BulkUpsertBuilder(ctx.am);
    builder.upsertAsset({ name: assetName, displayName: name, info: { symbol, contractAddress: addr }, updateType: 'create_or_ignore' });
    builder.upsertAddress({ address: addr, contract: true, updateType: 'create_or_ignore' });
    builder.upsertPool({ name: poolName, asset: assetName, address: addr, standard: 'ERC20', displayName: `${name} on ${chainLabel}`, labels: { chain: chainLabel, symbol }, updateType: 'create_or_ignore' });
    await builder.execute();

    if (stream) {
      await ensureStream(ctx, {
        connectorBindingName: stream.connectorBindingName,
        factory: stream.factory,
        name: stream.name,
        description: stream.description,
        eventSourceConfig: stream.eventSourceConfig,
      });
    }
  }

  async indexBatch(
    ctx: IndexerContext<ERC20Config>,
    events: EventProcessorEvent<EVMTransactionEvent>[],
  ): Promise<{ events: EventProcessorEvent<EVMTransactionEvent>[] }> {
    const { contractAddress, contractName, chain } = ctx.config;
    const addr = (contractAddress ?? '').toLowerCase();
    const poolName = (contractName ?? 'ERC20').toLowerCase();
    const chainLabel = chain ?? 'ethereum';

    const builder = new BulkUpsertBuilder(ctx.am);
    let highestBlock = 0;
    let transferCount = 0;

    log.info(`Received batch of ${events.length} events`);

    for (const event of events) {
      const tx = event.data;
      if (!tx.decodedEvents) continue;

      const blockNumber = parseInt(tx.block.number, 10);
      if (blockNumber > highestBlock) highestBlock = blockNumber;

      for (const decoded of tx.decodedEvents) {
        if (decoded.signature !== TRANSFER_SIG) {
          log.warn(`skipping event with signature ${decoded.signature} not matching ${TRANSFER_SIG}`);
          continue;
        }
        if (decoded.address.toLowerCase() !== addr) {
          log.warn(`skipping event with address ${decoded.address} not matching ${addr}`);
          continue;
        }

        const { from, to, value } = decoded.data as ERC20TransferData;
        const isMint = from === ZERO_ADDRESS;
        const isBurn = to === ZERO_ADDRESS;
        const contractAddr = decoded.address.toLowerCase();

        if (!isMint) builder.upsertAddress({ address: from.toLowerCase(), updateType: 'create_or_ignore' });
        if (!isBurn) builder.upsertAddress({ address: to.toLowerCase(), updateType: 'create_or_ignore' });
        builder.upsertAddress({ address: contractAddr, contract: true, updateType: 'create_or_ignore' });

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
          parent: { type: 'pool', ref: `${contractAddr}/${poolName}` },
          info: {
            blockNumber: tx.block.number,
            blockTimestamp: tx.block.timestamp,
            logIndex: decoded.logIndex,
          },
          balanceChanges,
          labels: { chain: chainLabel },
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

  createHandler(): IndexerHandlerDef<ERC20Config, EVMTransactionEvent> {
    return {
      setup: (ctx) => this.setup(ctx),
      process: (ctx, events) => this.indexBatch(ctx, events),
    };
  }
}
