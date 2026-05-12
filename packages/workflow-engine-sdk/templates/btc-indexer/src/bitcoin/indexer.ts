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
import type { Address, BalanceChange, Fragment, Transfer } from '../clients/asset-manager/models.js';
import type { BTCConfig } from '../config/provider-config.js';
import { BTCTransactionEvent, TxSummary, TxSummaryVOut } from '../../../../dist/src/types/btc/index.js';

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
  private networkIdHex!: string;
  private tokenName!: string;
  private networkName!: string;
  private poolName!: string;
  private assetName!: string;

  name(): string {
    return 'bitcoin-indexer';
  }

  init(_engAPI: EngineAPI): Promise<void> {
    return Promise.resolve();
  }

  close(): void {}

  /**
   * One-time setup: register the asset and pool in Asset Manager.
   * Must be called before the processor starts receiving batches.
   */
  async setup(amClient: AssetManagerClient, bitcoinConfig: BTCConfig): Promise<void> {
    this.amClient = amClient;
    this.networkId = bitcoinConfig.netId;
    this.networkIdHex = `0x${bitcoinConfig.netId.toString(16)}`;
    this.tokenName = bitcoinConfig.tokenName;
    this.networkName = bitcoinConfig.networkName;
    this.poolName = this.tokenName.toLowerCase();

    const symbol = bitcoinConfig.tokenSymbol ?? this.tokenName;
    this.assetName = `bitcoin_${this.tokenName.toLowerCase()}_${this.networkIdHex.toLowerCase()}`;

    await this.amClient.bulkUpsert({
      assets: [
        {
          name: this.assetName,
          displayName: this.tokenName,
          info: { symbol, contractAddress: this.networkIdHex },
          updateType: 'create_or_ignore',
        },
      ],
      addresses: [
        {
          address: this.networkIdHex,
          contract: true,
          updateType: 'create_or_ignore',
        },
      ],
      pools: [
        {
          name: this.poolName,
          asset: this.assetName,
          address: this.networkIdHex,
          standard: 'bitcoin',
          displayName: `${this.tokenName} on ${this.networkName}`,
          labels: { networkName: this.networkName, symbol },
          updateType: 'create_or_ignore',
        },
      ],
    });
  }

  /**
   * Process a batch of BTC transaction events.
   * Filters for Transfer events, builds balance changes, and bulk-upserts to AM.
   */
  async eventProcessorBatch(
    result: WSEventProcessorBatchResult,
    batch: WSEventProcessorBatchRequest,
  ): Promise<void> {
    const transfers: Transfer[] = [];
    const addressSet = new Set<string>();

    // console.log(JSON.stringify(batch.events[0], null, "  "))

    console.log('Received batch of', batch.events.length, 'events');

    const forEachTX = (fn: (tx: TxSummary, ed: BTCTransactionEvent, e: ListenerEvent) => void) => {
      for (const event of batch.events) {
        const eventData = event.data as BTCTransactionEvent;
        const { tx } = eventData;
        fn(tx, eventData, event);
      }
    }

    // Pass 1: Build a lookup for all the previous bitcoins that are used as inputs
    const fragmentsToLookup: string[] = []
    forEachTX((tx, ed) => {
      console.log(`Indexing TX ${tx} in block ${ed.block.height}`)
      for (let vin of tx.vin) {
        fragmentsToLookup.push(`${this.networkName}_${vin.txid}_${vin.vout}`);
      }
    })
    // TODO: Paginate if length > limit
    const indexedFragments = await this.amClient.bulkQuery({ fragments: {
      limit: fragmentsToLookup.length,
      in: [
        {field: "name", values: fragmentsToLookup}
      ]
    } });

    // Pass 2: identify all the addresses we know about, across both the
    // outputs, and the inputs where we've indexed the previous outpoint.
    const addressMap: Record<string, boolean> = {}
    forEachTX((tx) => {
      for (let vout of tx.vout) {
        if (vout.scriptPubKey?.address) {
          addressMap[vout.scriptPubKey?.address] = true
        }
      }
    })
    const inputDetail: Record<string,TxSummaryVOut> = {};
    for (let fragment of (indexedFragments.fragments?.items || []) ) {
      if (fragment.info) {
        const utxo = inputDetail[fragment.name] = fragment.info as TxSummaryVOut;
        if (utxo.scriptPubKey?.address) {
          addressMap[utxo.scriptPubKey?.address] = true
        }
      }
    }

    // Do the lookup of info for all those addresses
    // TODO: Paginate if length > limit
    const uniqueAddresses = Object.values(addressMap);
    const knownAddresses = await this.amClient.bulkQuery({ fragments: {
      limit: uniqueAddresses.length,
      in: [
        {field: "address", values: uniqueAddresses}
      ]
    } });
    const addressWallets: Record<string, string> = {};
    for (let addr of knownAddresses.addresses?.items || []) {
      if (addr.labels?.wallet) {
        // This is possible because the wallet backend mapping tags the addresses with
        // the wallet ID when they are created.
        addressWallets[addr.address] = addr.labels?.wallet
      }
    }

    // Pass 3: Build the upsert
    for (const event of batch.events) {
      const eventData = event.data as BTCTransactionEvent;
      const { tx, block, network } = eventData;
      const fragments: Fragment[] = [];

      // This is a misconfiguration, we don't want to miss events or fail to insert
      if (network.name != this.networkName || network.net != this.networkId) {
        throw new Error(`Network mismatch configured[name='${this.networkName}',net=${this.networkIdHex}] event[name='${network.name}',net=0x${network.net.toString(16)}}]`)
      }

      const xferOrdered: Transfer[] = []
      const xferByWallet: Record<string,Transfer> = {};
      const xferForAddr = (addr?: string): (Transfer|undefined) => {
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
              ref: `testnet4-btc.${safeWallet}`
            }
          }
          xferOrdered.push(xfer);
          xferByWallet[safeWallet] = xfer;
        }
        return xfer;
      }

      for (let iInput = 0; iInput < tx.vin.length; iInput++) {
        const vin = tx.vin[iInput];
        const name = `${this.networkName}_${vin.txid}_${vin.vout}`;
        fragments.push({
          updateType: 'create_or_update',
          address: this.networkIdHex,
          name,
          asset: this.assetName,
          labels: {
            networkName: this.networkName,
            mint_tx: vin.txid,
            spend_tx: tx.txid,
          },
        })
        const detail = inputDetail[name];
        if (detail) {
          const xfer = xferForAddr(detail.scriptPubKey?.address);
          if (detail.value && xfer) {
            xfer.balanceChanges.push({
              address: detail.scriptPubKey?.address!,
              amount: String(detail.value),
              operation: "subtract",
            })
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
          address: this.networkIdHex,
          info: vout,
          name: `${this.networkName}_${tx.txid}_${vout.n}`,
          asset: this.assetName,
          value,   
          labels,
        })
        const xfer = xferForAddr(vout.scriptPubKey?.address);
        if (vout.value && xfer) {
          xfer.balanceChanges.push({
            address: vout.scriptPubKey?.address!,
            amount: String(vout.value),
            operation: "add",
          })
        }
      }

      if (fragments.length > 0) {
        await this.amClient.bulkUpsert({ fragments, transfers: xferOrdered });
      }
    }

    result.checkpoint = { lastPollTime: Date.now() };
  }
}

export const bitcoinIndexer = new BTCIndexer();
