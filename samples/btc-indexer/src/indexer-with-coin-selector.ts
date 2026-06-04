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
  IndexerConfig,
  TransferBulkInput
} from '@kaleido-io/asset-manager-sdk';
import { BulkUpsertBuilder, IndexerWithTxnHandler } from '@kaleido-io/asset-manager-sdk';
import {
  EventProcessorEvent,
  InvocationMode,
  newLogger,
  RequestContext
} from '@kaleido-io/workflow-engine-sdk';
import type { BTCTransactionEvent, TxSummaryVOut } from '@kaleido-io/workflow-engine-sdk/types/btc';
import { BTCIndexerConfig } from './config.js';
import { BTCCoinSelector } from './coin-selector.js';

const log = newLogger('bitcoin-indexer');

export class BTCIndexer extends IndexerWithTxnHandler<BTCIndexerConfig, any> {
  private networkId!: number;
  private tokenName!: string;
  private networkName!: string;
  private upsertTriggerCount: number;
  private bulkQueryLimit: number;

  constructor(config: IndexerConfig<BTCIndexerConfig>) {
    super('btc-indexer', 'btc-coin-selector', {
      'selectCoins': {
        invocationMode: InvocationMode.BATCH,
        batchHandler: (new BTCCoinSelector(config)).selectCoins,
      }
    }, config);
    this.bulkQueryLimit = config.config?.bulkQueryLimit || 100;
    this.upsertTriggerCount = config.config?.upsertTriggerCount || 500;
  }

  /**
   * Performs one-time creation of DataModel objects that do not change, meaning these do not
   * need to be upserted on every processing cycle.
   * @param bitcoinConfig The configuration
   */
  override async indexerSetup(
    bitcoinConfig: BTCIndexerConfig,
  ): Promise<void> {
    this.networkId = Number(bitcoinConfig.networkId);
    this.networkName = bitcoinConfig.networkName;
    this.tokenName = bitcoinConfig.tokenName.toLowerCase();

    const symbol = bitcoinConfig.tokenSymbol ?? this.tokenName;

    const builder = new BulkUpsertBuilder(this.dmClient);
    builder.upsertAsset({ name: this.tokenName, displayName: this.tokenName, info: { symbol }, updateType: 'create_or_ignore' });
    builder.upsertAddress({ address: this.tokenName, contract: true, updateType: 'create_or_ignore' });
    builder.upsertPool({
      updateType: 'create_or_ignore',
      name: this.tokenName,
      asset: this.tokenName,
      address: this.tokenName,
      standard: 'bitcoin',
      displayName: `${this.tokenName} on ${this.networkName}`,
      labels: { networkName: this.networkName, symbol },
    });
    await builder.execute();
  }

  override async indexBatch(
    reqContext: RequestContext,
    events: EventProcessorEvent<BTCTransactionEvent>[],
  ): Promise<void> {
    if (events.length === 0) return;

    const builder = new BulkUpsertBuilder(this.dmClient, { reqContext }).autoFlush(this.upsertTriggerCount);
    const startTime = Date.now();
    log.info(`Received batch of ${events.length} events`);

    // Pass 1: look up fragments for all UTXOs spent as inputs across the batch
    const fragmentsToLookup: string[] = [];
    for (const event of events) {
      for (const vin of event.data.tx.vin) {
        fragmentsToLookup.push(`${this.networkName}_${vin.txid}_${vin.vout}`);
      }
    }

    const inputDetail: Record<string, TxSummaryVOut> = {};
    await this.batchLookupAggregate<Fragment>(
      fragmentsToLookup,
      (batch) => ({ fragments: {
        limit: batch.length, // the limit can be the number of items we're looking up - as we're assured to have a max of one per lookup
        in: [{ field: 'name', values: batch }], // the primary lookup is the name
        eq: [{ field: 'address', value: this.tokenName }], // but we MUST scope by address to ensure we get 0/1 item per entry (so the limit is sound)
      } }),
      (output) => output.fragments?.items ?? [],
      (fragments) => {
        for (const fragment of fragments) {
          if (fragment.info && fragment.name) {
            inputDetail[fragment.name] = fragment.info as TxSummaryVOut;
          }
        }
      },
    );

    // Pass 2: look up wallet labels for all addresses referenced in outputs and known inputs
    const addressSet = new Set<string>();
    for (const event of events) {
      for (const vout of event.data.tx.vout) {
        if (vout.scriptPubKey?.address) addressSet.add(vout.scriptPubKey.address);
      }
    }
    for (const utxo of Object.values(inputDetail)) {
      if (utxo.scriptPubKey?.address) addressSet.add(utxo.scriptPubKey.address);
    }

    const addressWallets: Record<string, string> = {};
    await this.batchLookupAggregate<Address>(
      [...addressSet],
      (batch) => ({ addresses: { limit: batch.length, in: [{ field: 'address', values: batch }] } }),
      (output) => output.addresses?.items ?? [],
      (addresses) => {
        for (const addr of addresses) {
          if (addr.labels?.wallet) {
            addressWallets[addr.address] = addr.labels.wallet;
          }
        }
      },
    );

    // Pass 3: build and upsert fragments + wallet-scoped transfers per event
    let txCount = 0;
    for (const event of events) {
      const { tx, block, network } = event.data;

      if (network.name !== this.networkName || network.net !== this.networkId) {
        throw new Error(
          `Network mismatch configured[name='${this.networkName}',net=${this.networkId}] ` +
          `event[name='${network.name}',net=0x${network.net.toString(16)}]`,
        );
      }

      log.debug(`Indexing TX ${tx.txid} in block ${block.height}`);
      txCount++;

      const fragments: FragmentBulkInput[] = [];
      const xferOrdered: TransferBulkInput[] = [];
      const xferByWallet: Record<string, TransferBulkInput> = {};

      const xferForAddr = (addr?: string): { walletId: string; transfer: TransferBulkInput } | undefined => {
        const walletId = addr && addressWallets[addr];
        if (!walletId) return undefined;
        const safeWallet = walletId.replace(':', '-');
        let xfer = xferByWallet[safeWallet];
        if (!xfer) {
          xfer = {
            updateType: 'create_or_ignore',
            protocolId: `${tx.txid}.${safeWallet}`,
            amount: '0',
            transactionHash: tx.txid,
            balanceChanges: [],
            parent: { type: 'pool', ref: `${this.tokenName}/${this.tokenName}` },
          };
          xferOrdered.push(xfer);
          xferByWallet[safeWallet] = xfer;
        }
        return { walletId: safeWallet, transfer: xfer };
      };

      for (const vin of tx.vin) {
        const name = `${this.networkName}_${vin.txid}_${vin.vout}`;
        fragments.push({
          updateType: 'create_or_ignore',
          address: this.tokenName,
          name,
          asset: this.tokenName,
          labels: { mint_tx: vin.txid, spend_tx: tx.txid },
        });

        const detail = inputDetail[name];
        if (detail) {
          const xfer = xferForAddr(detail.scriptPubKey?.address);
          if (xfer) {
            const value = satoshiValue(detail);
            if (value) {
              xfer.transfer.balanceChanges!.push({
                address: `${this.tokenName}_${xfer.walletId}`,
                amount: value,
                operation: 'subtract',
              });
              xfer.transfer.from = `${this.tokenName}_${xfer.walletId}`;
            }
          }
        }
      }

      for (const vout of tx.vout) {
        const labels: Record<string, string> = { mint_tx: tx.txid };
        if (vout.scriptPubKey?.address) labels.ownerAddress = vout.scriptPubKey.address;

        const value = satoshiValue(vout);
        fragments.push({
          updateType: 'create_or_ignore',
          address: this.tokenName,
          info: {
            ...vout,
            networkName: this.networkName,
            txid: tx.txid,
            blockHash: block.hash,
            blockHeight: block.height
          },
          name: `${this.networkName}_${tx.txid}_${vout.n}`,
          asset: this.tokenName,
          value,
          labels,
        });

        const xfer = xferForAddr(vout.scriptPubKey?.address);
        if (value && xfer) {
          xfer.transfer.balanceChanges!.push({
            address: `${this.tokenName}_${xfer.walletId}`,
            amount: value,
            operation: 'add',
          });
          xfer.transfer.to = `${this.tokenName}_${xfer.walletId}`;
        }
      }

      for (const fragment of fragments) await builder.upsertFragment(fragment);
      for (const xfer of xferOrdered) await builder.upsertTransfer(xfer);
    }

    // Flush the remainder
    await builder.execute();

    log.info(`Indexed ${txCount} transactions with a total of ${builder.getTotalCount()} updates in ${Date.now() - startTime}ms`);
  }


  /**
   * Helper function to look up a set of objects in the datamodel by a string identifier,
   * and paginate through the query to download them (noting they do not need to exist,
   * but the potential for them to exist means we have to limit the query).
   * @param lookups The complete list of lookup strings
   * @param buildQuery Build a query for a subset of the lookup strings
   * @param extractResults Extracts results back from the result set
   * @param aggregate Aggregation function to handle each batch
   */
  private async batchLookupAggregate<T>(
    lookups: string[],
    buildQuery: (batch: string[]) => BulkQueryInput,
    extractResults: (output: BulkQueryOutput) => T[],
    aggregate: (values: T[]) => void,
  ): Promise<void> {
    for (let i = 0; i < lookups.length; i += this.bulkQueryLimit) {
      const batch = lookups.slice(i, i + this.bulkQueryLimit);
      const result = await this.dmClient.bulkQuery(buildQuery(batch));
      aggregate(extractResults(result));
    }
  }
}

function satoshiValue(utxo: TxSummaryVOut): string | undefined {
  if (typeof utxo.valueSat === 'number') return String(utxo.valueSat);
  if (typeof utxo.value === 'number') return String(Math.floor(utxo.value * 100_000_000));
  return undefined;
}
