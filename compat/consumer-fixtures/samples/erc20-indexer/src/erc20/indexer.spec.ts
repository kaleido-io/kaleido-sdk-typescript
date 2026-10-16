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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDataModelClient } from '@kaleido-io/asset-manager-sdk';
import { AssetManagerClient, BulkUpsertBuilder } from '@kaleido-io/asset-manager-sdk';
import type { EventProcessorEvent, EventProcessorContext } from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEvent } from '@kaleido-io/connector-sdk/evm';
import { ERC20Indexer } from './indexer.js';
import type { ERC20Config } from '../config/provider-config.js';

vi.mock('@kaleido-io/asset-manager-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@kaleido-io/asset-manager-sdk')>();
  return { ...real, AssetManagerClient: vi.fn() };
});

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const CONTRACT = '0xcontract0000000000000000000000000000000001';
const ZERO    = '0x0000000000000000000000000000000000000000';
const WALLET_A = '0xaaaa000000000000000000000000000000000001';
const WALLET_B = '0xbbbb000000000000000000000000000000000002';

const ERC20_CONFIG: ERC20Config = {
  contractAddress: CONTRACT,
  contractName: 'TestToken',
  contractSymbol: 'TTK',
  chain: 'besu',
};

type MockFn = ReturnType<typeof vi.fn>;
type MockClient = { bulkUpsert: MockFn; bulkQuery: MockFn };

function mockEventProcessorContext(am: IDataModelClient, config: ERC20Config = ERC20_CONFIG): EventProcessorContext<ERC20Config> {
  const amWithBuilder = {
    ...am,
    getNewBulkUpsertBuilder: (opts?: unknown) => new BulkUpsertBuilder(am, opts as never),
  };
  vi.mocked(AssetManagerClient).mockImplementation(function() { return amWithBuilder as unknown as AssetManagerClient; } as never);
  return {
    config,
    providerName: 'test-provider',
    handlerName: 'erc20-indexer',
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    getServiceClientOptions: vi.fn(),
  };
}

function makeTxEvent(overrides: {
  blockNumber?: string;
  txHash?: string;
  logIndex?: string;
  from?: string;
  to?: string;
  value?: string;
  eventsAddress?: string;
  sig?: string;
}): EVMTransactionEvent {
  const {
    blockNumber = '1000001',
    txHash = '0xtx0000000000000000000000000000000000000000000000000000000000000001',
    logIndex = '0',
    from = WALLET_A,
    to = WALLET_B,
    value = '1000',
    eventsAddress = CONTRACT,
    sig = 'Transfer(address,address,uint256)',
  } = overrides;

  return {
    transactionHash: txHash,
    chainId: '1337',
    block: {
      number: blockNumber,
      hash: '0xblockhash',
      parentHash: '0xparenthash',
      timestamp: '1700000000',
      logsBloom: '0x',
      transactions: [txHash],
    },
    receipt: {
      transactionHash: txHash,
      transactionIndex: '0',
      blockHash: '0xblockhash',
      blockNumber,
      from: WALLET_A,
      to: CONTRACT,
      cumulativeGasUsed: '21000',
      effectiveGasPrice: '1000000000',
      gasUsed: '21000',
    },
    decodedEvents: [
      {
        logIndex,
        signature: sig,
        address: eventsAddress,
        data: { from, to, value },
      },
    ],
  };
}

function makeEvent(tx: EVMTransactionEvent): EventProcessorEvent<EVMTransactionEvent> {
  return { idempotencyKey: tx.transactionHash, topic: 'transfer', data: tx };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ERC20Indexer.processBatch()', () => {
  let mockClient: MockClient & IDataModelClient;
  let indexer: ERC20Indexer;
  let ctx: EventProcessorContext<ERC20Config>;

  beforeEach(async () => {
    mockClient = { bulkUpsert: vi.fn().mockResolvedValue({}), bulkQuery: vi.fn().mockResolvedValue({}) } as unknown as MockClient & IDataModelClient;
    ctx = mockEventProcessorContext(mockClient);
    indexer = new ERC20Indexer();
    await indexer.setup(ctx);
    vi.clearAllMocks(); // clear the setup() bulkUpsert call
  });

  it('does not call bulkUpsert for an empty batch', async () => {
    await indexer.processBatch(ctx, []);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
  });

  it('does not call bulkUpsert when decodedEvents is absent', async () => {
    const tx = makeTxEvent({});
    delete (tx as any).decodedEvents;
    await indexer.processBatch(ctx, [makeEvent(tx)]);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
  });

  it('skips events with a non-Transfer signature', async () => {
    const tx = makeTxEvent({ sig: 'Approval(address,address,uint256)' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
  });

  it('skips events from a different contract address', async () => {
    const tx = makeTxEvent({ eventsAddress: '0xother000000000000000000000000000000000001' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
  });

  it('processes a regular transfer correctly', async () => {
    const tx = makeTxEvent({ from: WALLET_A, to: WALLET_B, value: '500', blockNumber: '1000001' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const payload = (mockClient.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Addresses: wallet A, wallet B, contract (deduped to 3)
    expect(payload.addresses).toHaveLength(3);
    expect(payload.addresses).toContainEqual(expect.objectContaining({ address: WALLET_A.toLowerCase(), updateType: 'create_or_ignore' }));
    expect(payload.addresses).toContainEqual(expect.objectContaining({ address: WALLET_B.toLowerCase(), updateType: 'create_or_ignore' }));
    expect(payload.addresses).toContainEqual(expect.objectContaining({ address: CONTRACT.toLowerCase(), contract: true }));

    // Transfer
    expect(payload.transfers).toHaveLength(1);
    expect(payload.transfers[0]).toMatchObject({
      protocolId: `1000001/${tx.transactionHash}/0`,
      from: WALLET_A,
      to: WALLET_B,
      amount: '500',
      transactionHash: tx.transactionHash,
      parent: { type: 'pool', ref: `${CONTRACT.toLowerCase()}/testtoken` },
      balanceChanges: [
        { address: WALLET_A, operation: 'subtract', amount: '500' },
        { address: WALLET_B, operation: 'add',      amount: '500' },
      ],
      labels: { chain: 'besu' },
      updateType: 'create_or_replace',
    });
  });

  it('lowercases checksummed (mixed-case) addresses in transfer and balanceChanges', async () => {
    const MIXED_FROM = '0xAbCdEf0000000000000000000000000000000001';
    const MIXED_TO = '0xFeDcBa0000000000000000000000000000000002';
    const tx = makeTxEvent({ from: MIXED_FROM, to: MIXED_TO, value: '500' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);

    const payload = (mockClient.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Address entries are lowercased (the Asset Manager stores them lowercased)
    expect(payload.addresses).toContainEqual(expect.objectContaining({ address: MIXED_FROM.toLowerCase() }));
    expect(payload.addresses).toContainEqual(expect.objectContaining({ address: MIXED_TO.toLowerCase() }));

    // Transfer endpoints and balance-change addresses must match the lowercased
    // entries — otherwise balances never reconcile against the registered addresses.
    expect(payload.transfers[0]).toMatchObject({
      from: MIXED_FROM.toLowerCase(),
      to: MIXED_TO.toLowerCase(),
      balanceChanges: [
        { address: MIXED_FROM.toLowerCase(), operation: 'subtract', amount: '500' },
        { address: MIXED_TO.toLowerCase(), operation: 'add', amount: '500' },
      ],
    });
  });

  it('processes a mint (from = zero address)', async () => {
    const tx = makeTxEvent({ from: ZERO, to: WALLET_B, value: '1000' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);

    const payload = (mockClient.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // No address for zero address (mint source), only receiver + contract
    expect(payload.addresses).toHaveLength(2);
    expect(payload.addresses).not.toContainEqual(expect.objectContaining({ address: ZERO }));

    expect(payload.transfers[0]).toMatchObject({
      from: undefined,
      to: WALLET_B,
      balanceChanges: [
        { address: WALLET_B,     operation: 'add', amount: '1000' },
        { address: 'circulation', operation: 'add', amount: '1000' },
      ],
    });
  });

  it('processes a burn (to = zero address)', async () => {
    const tx = makeTxEvent({ from: WALLET_A, to: ZERO, value: '250' });
    await indexer.processBatch(ctx, [makeEvent(tx)]);

    const payload = (mockClient.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // No address for zero address (burn destination), only sender + contract
    expect(payload.addresses).toHaveLength(2);
    expect(payload.addresses).not.toContainEqual(expect.objectContaining({ address: ZERO }));

    expect(payload.transfers[0]).toMatchObject({
      from: WALLET_A,
      to: undefined,
      balanceChanges: [
        { address: WALLET_A,     operation: 'subtract', amount: '250' },
        { address: 'circulation', operation: 'subtract', amount: '250' },
      ],
    });
  });

  it('deduplicates addresses across multiple transfers in one batch', async () => {
    // Three transfers all involving the same two wallets
    const events = [
      makeEvent(makeTxEvent({ from: WALLET_A, to: WALLET_B, value: '100', blockNumber: '1000001', txHash: '0xtx01', logIndex: '0' })),
      makeEvent(makeTxEvent({ from: WALLET_B, to: WALLET_A, value: '50',  blockNumber: '1000002', txHash: '0xtx02', logIndex: '0' })),
      makeEvent(makeTxEvent({ from: WALLET_A, to: WALLET_B, value: '75',  blockNumber: '1000003', txHash: '0xtx03', logIndex: '0' })),
    ];

    await indexer.processBatch(ctx, events);

    const payload = (mockClient.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Despite 3 transfers (6 address references), only 3 unique addresses
    expect(payload.addresses).toHaveLength(3);
    expect(payload.transfers).toHaveLength(3);
  });

  it('calls bulkUpsert exactly once per batch regardless of transfer count', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(makeTxEvent({ txHash: `0xtx${i.toString().padStart(2, '0')}`, logIndex: '0', blockNumber: String(1000000 + i) }))
    );

    await indexer.processBatch(ctx, events);
    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
  });
});
