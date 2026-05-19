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
  EngineAPI,
  ListenerEvent,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
} from '@kaleido-io/workflow-engine-sdk';

// import type { BTCTransactionEvent } from '@kaleido-io/workflow-engine-sdk/types/btc';
import { AssetManagerClient } from '../clients/asset-manager/client.js';
import type { Address, Fragment, Transfer } from '../clients/asset-manager/models.js';
import type { BTCConfig } from '../config/provider-config.js';
import { BTCTransactionEvent, TxSummary, TxSummaryVOut } from '../../../../dist/src/types/btc/index.js';
import { BulkQueryInput, BulkQueryOutput } from '../clients/asset-manager/bulkquery.js';

/**
 * BTC Transfer event processor.
 *
 * Receives decoded BTC transaction batches from a WFE `btcTransactions` stream,
 * maps Transfer(address,address,uint256) events to Asset Manager data models,
 * and bulk-upserts addresses + transfers into the Asset Manager.
 *
 * Call `setup()` once before registering with the WFE client to create the
 * asset and pool definitions in the Asset Manager.
 */
export class BTCIndexer {
  private amClient!: AssetManagerClient;
  private networkId!: number;
  private tokenName!: string;
  private networkName!: string;

  name(): string {
    return 'bitcoin-indexer';
  }

  init(_engAPI: EngineAPI): Promise<void> {
    return Promise.resolve();
  }

  close(): void {}

  log(s: string, ...args: any) {
    console.log(`${new Date().toUTCString()}: ${s}`, ...args)
  }

  /**
   * One-time setup: register the asset and pool in Asset Manager.
   * Must be called before the processor starts receiving batches.
   */
  async setup(amClient: AssetManagerClient, bitcoinConfig: BTCConfig): Promise<void> {
    this.amClient = amClient;
    this.networkId = bitcoinConfig.netId;
    this.tokenName = bitcoinConfig.tokenName.toLowerCase();
    this.networkName = bitcoinConfig.chain;

    const symbol = bitcoinConfig.tokenSymbol ?? this.tokenName;

    await this.amClient.bulkUpsert({
      assets: [
        {
          name: this.tokenName,
          displayName: this.tokenName,
          info: { symbol },
          updateType: 'create_or_ignore',
        },
      ],
      addresses: [
        {
          address: this.tokenName,
          contract: true,
          updateType: 'create_or_ignore',
        },
      ],
      pools: [
        {
          name: this.tokenName,
          asset: this.tokenName,
          address: this.tokenName,
          standard: 'bitcoin',
          displayName: `${this.tokenName} on ${this.networkName}`,
          labels: { networkName: this.networkName, symbol },
          updateType: 'create_or_ignore',
        },
      ],
    });
  }

  async batchLookup<T>(
    lookups: string[],
    buildQuery: (batch: string[]) => BulkQueryInput,
    extractResults: (output: BulkQueryOutput) => T[],
    handleResults: (values: T[]) => void,
  ): Promise<void> {
    const BATCH_SIZE = 100;
    for (let i = 0; i < lookups.length; i += BATCH_SIZE) {
      const batch = lookups.slice(i, i + BATCH_SIZE);
      const result = await this.amClient.bulkQuery(buildQuery(batch));
      handleResults(extractResults(result));
    }
  }

  /**
   * Process a batch of BTC transaction events.
   * Filters for Transfer events, builds balance changes, and bulk-upserts to AM.
   */
  async eventProcessorBatch(
    result: WSEventProcessorBatchResult,
    batch: WSEventProcessorBatchRequest,
  ): Promise<void> {

    // this.log(JSON.stringify(batch.events[0], null, "  "))

    const startTime = new Date();
    this.log('Received batch of', batch.events.length, 'events');

    const forEachTX = (fn: (tx: TxSummary, ed: BTCTransactionEvent, e: ListenerEvent) => void) => {
      for (const event of batch.events) {
        const eventData = event.data as BTCTransactionEvent;
        const { tx } = eventData;
        fn(tx, eventData, event);
      }
    }

    // Pass 1: Build a lookup for all the previous bitcoins that are used as inputs
    let txCount = 0;
    const fragmentsToLookup: string[] = [];
    forEachTX((tx, ed) => {
      txCount++;
      this.log(`Indexing TX ${tx.txid} in block ${ed.block.height}`);
      for (const vin of tx.vin) {
        fragmentsToLookup.push(`${this.networkName}_${vin.txid}_${vin.vout}`);
      }
    });
    const inputDetail: Record<string, TxSummaryVOut> = {};
    await this.batchLookup<Fragment>(
      fragmentsToLookup,
      (batch) => ({ fragments: { limit: batch.length, in: [{ field: 'name', values: batch }] } }),
      (output) => output.fragments?.items ?? [],
      (fragments) => {
        for (const fragment of fragments) {
          if (fragment.info) {
            inputDetail[fragment.name] = fragment.info as TxSummaryVOut;
          }
        }
      },
    );

    // Pass 2: identify all the addresses we know about, across both the
    // outputs, and the inputs where we've indexed the previous outpoint.
    const addressMap: Record<string, boolean> = {};
    forEachTX((tx) => {
      for (const vout of tx.vout) {
        if (vout.scriptPubKey?.address) {
          addressMap[vout.scriptPubKey.address] = true;
        }
      }
    });
    for (const utxo of Object.values(inputDetail)) {
      if (utxo.scriptPubKey?.address) {
        addressMap[utxo.scriptPubKey.address] = true;
      }
    }

    // Do the lookup of info for all those addresses
    const addressWallets: Record<string, string> = {};
    await this.batchLookup<Address>(
      Object.keys(addressMap),
      (batch) => ({ addresses: { limit: batch.length, in: [{ field: 'address', values: batch }] } }),
      (output) => output.addresses?.items ?? [],
      (addresses) => {
        for (const addr of addresses) {
          if (addr.labels?.wallet) {
            // The wallet backend tags addresses with the wallet ID when they are created.
            addressWallets[addr.address] = addr.labels.wallet;
          }
        }
      },
    );

    // Pass 3: Build the upsert
    for (const event of batch.events) {
      const eventData = event.data as BTCTransactionEvent;
      const { tx, network } = eventData;
      const fragments: Fragment[] = [];

      // This is a misconfiguration, we don't want to miss events or fail to insert
      if (network.name != this.networkName || network.net != this.networkId) {
        throw new Error(`Network mismatch configured[name='${this.networkName}',net=${this.networkId}] event[name='${network.name}',net=0x${network.net.toString(16)}}]`)
      }

      const xferOrdered: Transfer[] = []
      const xferByWallet: Record<string,Transfer> = {};
      const xferForAddr = (addr?: string): ({walletId: string, transfer: Transfer}|undefined) => {
        const walletId = addr && addressWallets[addr];
        if (!walletId) {
          return undefined;
        }
        const safeWallet = walletId.replace(':','-');
        let xfer = xferByWallet[safeWallet];
        if (!xfer) {
          xfer = {
            protocolId: `tx.txid.${safeWallet}`,
            amount: "0",
            transactionHash: tx.txid,
            balanceChanges: [],
            parent: {
              type: "pool",
              ref: `${this.tokenName}/${this.tokenName}`
            }
          }
          xferOrdered.push(xfer);
          xferByWallet[safeWallet] = xfer;
        }

        return {
          walletId: safeWallet,
          transfer: xfer,
        };
      }

      for (let iInput = 0; iInput < tx.vin.length; iInput++) {
        const vin = tx.vin[iInput];
        const name = `${this.networkName}_${vin.txid}_${vin.vout}`;
        fragments.push({
          updateType: 'create_or_update',
          address: this.tokenName,
          name,
          asset: this.tokenName,
          labels: {
            networkName: this.networkName,
            mint_tx: vin.txid,
            spend_tx: tx.txid,
          },
        })
        const detail = inputDetail[name];
        if (detail) {
          const xfer = xferForAddr(detail.scriptPubKey?.address);
          if (xfer) {
            let value: string | undefined;
            if (typeof detail.valueSat == 'number') {
              value = String(detail.valueSat)
            } else if (typeof detail.value == 'number') {
              value = String(Math.floor(detail.value * 100_000_000))
            }
            if (value) {
              xfer.transfer.balanceChanges.push({
                address: `${this.tokenName}_${xfer.walletId}`,
                amount: value,
                operation: "subtract",
              })
              xfer.transfer.from = `${this.tokenName}_${xfer.walletId}`;
            }
          }
        }
      }

      for (let iOutput = 0; iOutput < tx.vout.length; iOutput++) {
        const vout = tx.vout[iOutput];
        const labels: Record<string, string> = {
          networkName: this.networkName,
          mint_tx: tx.txid,
        }
        const ownerAddress = vout.scriptPubKey?.address;
        if (typeof ownerAddress == 'string' && ownerAddress.length > 0) {
          labels.ownerAddress = ownerAddress;
        }
        let value: string | undefined;
        if (typeof vout.valueSat == 'number') {
          value = String(vout.valueSat)
        } else if (typeof vout.value == 'number') {
          value = String(Math.floor(vout.value * 100_000_000))
        }
        fragments.push({
          updateType: 'create_or_update',
          address: this.tokenName,
          info: vout,
          name: `${this.networkName}_${tx.txid}_${vout.n}`,
          asset: this.tokenName,
          value,   
          labels,
        })
        const xfer = xferForAddr(vout.scriptPubKey?.address);
        if (value && xfer) {
          xfer.transfer.balanceChanges.push({
            address: `${this.tokenName}_${xfer.walletId}`,
            amount: value,
            operation: "add",
          })
          xfer.transfer.to = `${this.tokenName}_${xfer.walletId}`;
        }
      }

      if (fragments.length > 0) {
        await this.amClient.bulkUpsert({ fragments, transfers: xferOrdered });
      }
    }

    this.log(`Indexed ${txCount} transactions in ${new Date().getTime()-startTime.getTime()}ms`)
    result.checkpoint = { lastPollTime: Date.now() };
  }
}

export const bitcoinIndexer = new BTCIndexer();
