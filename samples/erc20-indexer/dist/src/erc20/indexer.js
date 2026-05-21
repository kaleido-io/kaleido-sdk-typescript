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
const log = newLogger('erc20-indexer');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_SIG = 'Transfer(address,address,uint256)';
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
export class ERC20Indexer {
    amClient;
    contractAddress;
    contractName;
    chain;
    poolName;
    handler;
    constructor() {
        this.handler = createEventProcessor('erc20-indexer', (events) => this.process(events));
    }
    /**
     * One-time setup: register the asset and pool in Asset Manager.
     * Must be called before the processor starts receiving batches.
     */
    async setup(amClient, erc20Config) {
        this.amClient = amClient;
        this.contractAddress = (erc20Config.contractAddress ?? '').toLowerCase();
        this.contractName = erc20Config.contractName ?? 'ERC20';
        this.chain = erc20Config.chain ?? 'ethereum';
        this.poolName = this.contractName.toLowerCase();
        const symbol = erc20Config.contractSymbol ?? this.contractName;
        const assetName = `${this.contractName.toLowerCase()}_${this.contractAddress.toLowerCase()}`;
        await this.amClient.bulkUpsert({
            assets: [
                {
                    name: assetName,
                    displayName: this.contractName,
                    info: { symbol, contractAddress: this.contractAddress },
                    updateType: 'create_or_ignore',
                },
            ],
            addresses: [
                {
                    address: this.contractAddress,
                    contract: true,
                    updateType: 'create_or_ignore',
                },
            ],
            pools: [
                {
                    name: this.poolName,
                    asset: assetName,
                    address: this.contractAddress,
                    standard: 'ERC20',
                    displayName: `${this.contractName} on ${this.chain}`,
                    labels: { chain: this.chain, symbol },
                    updateType: 'create_or_ignore',
                },
            ],
        });
    }
    async process(events) {
        const builder = new BulkUpsertBuilder(this.amClient);
        let highestBlock = 0;
        let transferCount = 0;
        log.info(`Received batch of ${events.length} events`);
        for (const event of events) {
            const tx = event.data;
            if (!tx.decodedEvents)
                continue;
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
                const { from, to, value } = decoded.data;
                const isMint = from === ZERO_ADDRESS;
                const isBurn = to === ZERO_ADDRESS;
                const contractAddr = decoded.address.toLowerCase();
                if (!isMint)
                    builder.upsertAddress({ address: from.toLowerCase(), updateType: 'create_or_ignore' });
                if (!isBurn)
                    builder.upsertAddress({ address: to.toLowerCase(), updateType: 'create_or_ignore' });
                builder.upsertAddress({ address: contractAddr, contract: true, updateType: 'create_or_ignore' });
                // Balance deltas: subtract from sender, add to receiver.
                // Mints/burns update a virtual "circulation" address for total supply tracking.
                const balanceChanges = [];
                if (!isMint)
                    balanceChanges.push({ address: from, operation: 'subtract', amount: String(value) });
                if (!isBurn)
                    balanceChanges.push({ address: to, operation: 'add', amount: String(value) });
                if (isMint)
                    balanceChanges.push({ address: 'circulation', operation: 'add', amount: String(value) });
                if (isBurn)
                    balanceChanges.push({ address: 'circulation', operation: 'subtract', amount: String(value) });
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
        }
        else {
            log.info(`No matching Transfer events in batch (highest block ${highestBlock})`);
        }
        await builder.execute();
        return {
            events,
            checkpointOut: highestBlock > 0 ? { highestBlock } : undefined,
        };
    }
}
export const erc20Indexer = new ERC20Indexer();
