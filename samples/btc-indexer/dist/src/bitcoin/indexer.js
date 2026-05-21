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
import { createEventProcessor, newLogger, } from '@kaleido-io/workflow-engine-sdk';
import { BulkUpsertBuilder } from '@kaleido-io/asset-manager-sdk';
const log = newLogger('bitcoin-indexer');
export class BTCIndexer {
    amClient;
    networkId;
    tokenName;
    networkName;
    handler;
    constructor() {
        this.handler = createEventProcessor('bitcoin-indexer', (events) => this.process(events));
    }
    async setup(amClient, bitcoinConfig) {
        this.amClient = amClient;
        this.networkId = bitcoinConfig.netId;
        this.tokenName = bitcoinConfig.tokenName.toLowerCase();
        this.networkName = bitcoinConfig.chain;
        const symbol = bitcoinConfig.tokenSymbol ?? this.tokenName;
        const builder = new BulkUpsertBuilder(this.amClient);
        builder.upsertAsset({ name: this.tokenName, displayName: this.tokenName, info: { symbol }, updateType: 'create_or_ignore' });
        builder.upsertAddress({ address: this.tokenName, contract: true, updateType: 'create_or_ignore' });
        builder.upsertPool({
            name: this.tokenName,
            asset: this.tokenName,
            address: this.tokenName,
            standard: 'bitcoin',
            displayName: `${this.tokenName} on ${this.networkName}`,
            labels: { networkName: this.networkName, symbol },
            updateType: 'create_or_ignore',
        });
        await builder.execute();
    }
    async batchLookup(lookups, buildQuery, extractResults, handleResults) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < lookups.length; i += BATCH_SIZE) {
            const batch = lookups.slice(i, i + BATCH_SIZE);
            const result = await this.amClient.bulkQuery(buildQuery(batch));
            handleResults(extractResults(result));
        }
    }
    async process(events) {
        if (events.length === 0) {
            return { events };
        }
        const builder = new BulkUpsertBuilder(this.amClient);
        const startTime = Date.now();
        log.info(`Received batch of ${events.length} events`);
        // Pass 1: look up fragments for all UTXOs spent as inputs across the batch
        const fragmentsToLookup = [];
        for (const event of events) {
            for (const vin of event.data.tx.vin) {
                fragmentsToLookup.push(`${this.networkName}_${vin.txid}_${vin.vout}`);
            }
        }
        const inputDetail = {};
        await this.batchLookup(fragmentsToLookup, (batch) => ({ fragments: { limit: batch.length, in: [{ field: 'name', values: batch }] } }), (output) => output.fragments?.items ?? [], (fragments) => {
            for (const fragment of fragments) {
                if (fragment.info && fragment.name) {
                    inputDetail[fragment.name] = fragment.info;
                }
            }
        });
        // Pass 2: look up wallet labels for all addresses referenced in outputs and known inputs
        const addressSet = new Set();
        for (const event of events) {
            for (const vout of event.data.tx.vout) {
                if (vout.scriptPubKey?.address)
                    addressSet.add(vout.scriptPubKey.address);
            }
        }
        for (const utxo of Object.values(inputDetail)) {
            if (utxo.scriptPubKey?.address)
                addressSet.add(utxo.scriptPubKey.address);
        }
        const addressWallets = {};
        await this.batchLookup([...addressSet], (batch) => ({ addresses: { limit: batch.length, in: [{ field: 'address', values: batch }] } }), (output) => output.addresses?.items ?? [], (addresses) => {
            for (const addr of addresses) {
                if (addr.labels?.wallet) {
                    addressWallets[addr.address] = addr.labels.wallet;
                }
            }
        });
        // Pass 3: build and upsert fragments + wallet-scoped transfers per event
        let txCount = 0;
        for (const event of events) {
            const { tx, block, network } = event.data;
            if (network.name !== this.networkName || network.net !== this.networkId) {
                throw new Error(`Network mismatch configured[name='${this.networkName}',net=${this.networkId}] ` +
                    `event[name='${network.name}',net=0x${network.net.toString(16)}]`);
            }
            log.debug(`Indexing TX ${tx.txid} in block ${block.height}`);
            txCount++;
            const fragments = [];
            const xferOrdered = [];
            const xferByWallet = {};
            const xferForAddr = (addr) => {
                const walletId = addr && addressWallets[addr];
                if (!walletId)
                    return undefined;
                const safeWallet = walletId.replace(':', '-');
                let xfer = xferByWallet[safeWallet];
                if (!xfer) {
                    xfer = {
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
                    updateType: 'create_or_update',
                    address: this.tokenName,
                    name,
                    asset: this.tokenName,
                    labels: { networkName: this.networkName, mint_tx: vin.txid, spend_tx: tx.txid },
                });
                const detail = inputDetail[name];
                if (detail) {
                    const xfer = xferForAddr(detail.scriptPubKey?.address);
                    if (xfer) {
                        const value = satoshiValue(detail);
                        if (value) {
                            xfer.transfer.balanceChanges.push({
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
                const labels = { networkName: this.networkName, mint_tx: tx.txid };
                if (vout.scriptPubKey?.address)
                    labels.ownerAddress = vout.scriptPubKey.address;
                const value = satoshiValue(vout);
                fragments.push({
                    updateType: 'create_or_update',
                    address: this.tokenName,
                    info: vout,
                    name: `${this.networkName}_${tx.txid}_${vout.n}`,
                    asset: this.tokenName,
                    value,
                    labels,
                });
                const xfer = xferForAddr(vout.scriptPubKey?.address);
                if (value && xfer) {
                    xfer.transfer.balanceChanges.push({
                        address: `${this.tokenName}_${xfer.walletId}`,
                        amount: value,
                        operation: 'add',
                    });
                    xfer.transfer.to = `${this.tokenName}_${xfer.walletId}`;
                }
            }
            for (const fragment of fragments) builder.upsertFragment(fragment);
            for (const xfer of xferOrdered) builder.upsertTransfer(xfer);
        }

        // Do the upsert
        await builder.execute();

        log.info(`Indexed ${txCount} transactions in ${Date.now() - startTime}ms`);
        return { events };
    }
}
function satoshiValue(utxo) {
    if (typeof utxo.valueSat === 'number')
        return String(utxo.valueSat);
    if (typeof utxo.value === 'number')
        return String(Math.floor(utxo.value * 100_000_000));
    return undefined;
}
export const bitcoinIndexer = new BTCIndexer();
