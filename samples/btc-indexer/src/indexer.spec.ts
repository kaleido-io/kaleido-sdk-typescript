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

import type { EventProcessorEvent, IndexerContext } from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient, BulkUpsertBuilder } from '@kaleido-io/asset-manager-sdk';
import type { IDataModelClient } from '@kaleido-io/asset-manager-sdk';
import type { BTCTransactionEvent, TxSummaryVIn, TxSummaryVOut } from '@kaleido-io/connector-sdk/btc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BTCIndexerConfig } from './config.js';
import { BTCIndexer } from './indexer.js';

vi.mock('@kaleido-io/asset-manager-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@kaleido-io/asset-manager-sdk')>();
  return { ...real, AssetManagerClient: vi.fn() };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NETWORK = { name: 'mainnet', net: 0x283f161c };
const BLOCK   = { height: 850000, hash: '0000000000000000000320a45a9de87b8e9df35dace16ab9bba4dc7a4611e2a2' };

const BTC_CONFIG: BTCIndexerConfig = {
  networkId:    String(NETWORK.net),
  networkName:  NETWORK.name,
  tokenName:   'bitcoin',
  tokenSymbol: 'BTC',
};

type MockClient = { bulkUpsert: ReturnType<typeof vi.fn>; bulkQuery: ReturnType<typeof vi.fn> };

function mockIndexerContext(client: MockClient, config: BTCIndexerConfig = BTC_CONFIG): IndexerContext<BTCIndexerConfig> {
  const amWithBuilder = {
    ...client,
    getNewBulkUpsertBuilder: (opts?: unknown) => new BulkUpsertBuilder(client as unknown as IDataModelClient, opts as never),
  };
  vi.mocked(AssetManagerClient).mockImplementation(function() { return amWithBuilder as unknown as AssetManagerClient; } as never);
  return {
    config,
    providerName: 'test-provider',
    handlerName: 'bitcoin-indexer',
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    getServiceClientOptions: vi.fn(),
  };
}

function makeVIn(txid: string, vout: number): TxSummaryVIn {
  return { txid, vout, scriptSig: { hex: '' }, sequence: 0xffffffff };
}

function makeVOut(n: number, valueSat: number, address?: string): TxSummaryVOut {
  return {
    n,
    valueSat,
    scriptPubKey: address ? { hex: '', address, type: 'p2pkh' } : { hex: '', type: 'nulldata' },
  };
}

function makeTxEvent(overrides: {
  txid?: string;
  vin?: TxSummaryVIn[];
  vout?: TxSummaryVOut[];
  network?: typeof NETWORK;
}): BTCTransactionEvent {
  return {
    network: overrides.network ?? NETWORK,
    block:   BLOCK,
    tx: {
      txid:     overrides.txid ?? 'tx001',
      hash:     overrides.txid ?? 'tx001',
      version:  1,
      locktime: 0,
      vin:      overrides.vin  ?? [],
      vout:     overrides.vout ?? [],
    },
  };
}

function makeEvent(btcTx: BTCTransactionEvent): EventProcessorEvent<BTCTransactionEvent> {
  return { idempotencyKey: btcTx.tx.txid, topic: 'btcTransactions', data: btcTx };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BTCIndexer.setup()', () => {
  it('upserts asset, address, and pool with create_or_ignore', async () => {
    const client: MockClient = { bulkUpsert: vi.fn().mockResolvedValue({}), bulkQuery: vi.fn() };
    const ctx = mockIndexerContext(client);
    const indexer = new BTCIndexer();
    await indexer.setup(ctx);

    expect(client.bulkUpsert).toHaveBeenCalledTimes(1);
    const payload = client.bulkUpsert.mock.calls[0][0];

    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toMatchObject({ name: 'bitcoin', updateType: 'create_or_ignore' });

    expect(payload.addresses).toHaveLength(1);
    expect(payload.addresses[0]).toMatchObject({ address: 'bitcoin', contract: true, updateType: 'create_or_ignore' });

    expect(payload.pools).toHaveLength(1);
    expect(payload.pools[0]).toMatchObject({ name: 'bitcoin', asset: 'bitcoin', standard: 'bitcoin', updateType: 'create_or_ignore' });
  });
});

describe('BTCIndexer.process()', () => {
  let mockClient: MockClient;
  let indexer: BTCIndexer;
  let ctx: IndexerContext<BTCIndexerConfig>;

  beforeEach(async () => {
    mockClient = {
      bulkUpsert: vi.fn().mockResolvedValue({}),
      bulkQuery:  vi.fn().mockResolvedValue({
        fragments: { items: [], count: 0, allItems: true },
        addresses: { items: [], count: 0, allItems: true },
      }),
    };
    ctx = mockIndexerContext(mockClient);
    indexer = new BTCIndexer();
    await indexer.setup(ctx);
    vi.clearAllMocks();
  });

  it('makes no calls for an empty batch', async () => {
    const result = await indexer.indexBatch(ctx, []);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
    expect(mockClient.bulkQuery).not.toHaveBeenCalled();
    expect(result.events).toHaveLength(0);
  });

  it('throws on network name mismatch', async () => {
    const event = makeEvent(makeTxEvent({ network: { name: 'testnet4', net: NETWORK.net } }));
    await expect(indexer.indexBatch(ctx, [event])).rejects.toThrow(/Network mismatch/);
  });

  it('throws on network id mismatch', async () => {
    const event = makeEvent(makeTxEvent({ network: { name: NETWORK.name, net: 0x00000001 } }));
    await expect(indexer.indexBatch(ctx, [event])).rejects.toThrow(/Network mismatch/);
  });

  it('upserts input and output fragments when no wallets are involved', async () => {
    const event = makeEvent(makeTxEvent({
      txid: 'tx001',
      vin:  [makeVIn('prevtx', 0)],
      vout: [makeVOut(0, 50000, 'addr1')],
    }));

    await indexer.indexBatch(ctx, [event]);

    // Fragment query for the spent input, address query for the output address
    expect(mockClient.bulkQuery).toHaveBeenCalledTimes(2);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const { fragments, transfers } = mockClient.bulkUpsert.mock.calls[0][0];

    // One fragment marking the input as spent, one for the new output UTXO
    expect(fragments).toHaveLength(2);
    expect(fragments).toContainEqual(expect.objectContaining({
      name: 'mainnet_prevtx_0',
      updateType: 'create_or_ignore',
      labels: expect.objectContaining({ spend_tx: 'tx001', mint_tx: 'prevtx' }),
    }));
    expect(fragments).toContainEqual(expect.objectContaining({
      name: 'mainnet_tx001_0',
      value: '50000',
      labels: expect.objectContaining({ ownerAddress: 'addr1' }),
    }));

    // No transfers — neither address has a wallet label
    expect(transfers).toBeUndefined();
  });

  it('creates a transfer with an add balance change for a known receiver wallet', async () => {
    const event = makeEvent(makeTxEvent({
      txid: 'tx002',
      vin:  [makeVIn('prevtx', 0)],
      vout: [makeVOut(0, 40000, 'addr1')],
    }));

    // First bulkQuery (fragments): nothing known for prevtx:0
    // Second bulkQuery (addresses): addr1 belongs to wallet1
    mockClient.bulkQuery
      .mockResolvedValueOnce({ fragments: { items: [], count: 0, allItems: true } })
      .mockResolvedValueOnce({
        addresses: {
          items: [{ address: 'addr1', labels: { wallet: 'wallet1' } }],
          count: 1,
          allItems: true,
        },
      });

    await indexer.indexBatch(ctx, [event]);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const { transfers } = mockClient.bulkUpsert.mock.calls[0][0];

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      protocolId: 'tx002.wallet1',
      transactionHash: 'tx002',
      parent: { type: 'pool', ref: 'bitcoin/bitcoin' },
    });
    expect(transfers[0].balanceChanges).toHaveLength(1);
    expect(transfers[0].balanceChanges[0]).toMatchObject({
      address: 'bitcoin_wallet1',
      amount: '40000',
      operation: 'add',
    });
    expect(transfers[0].to).toBe('bitcoin_wallet1');
  });

  it('creates a transfer with a subtract balance change for a known input wallet', async () => {
    const prevUtxoInfo: TxSummaryVOut = { n: 0, valueSat: 50000, scriptPubKey: { hex: '', address: 'addr2', type: 'p2pkh' } };

    const event = makeEvent(makeTxEvent({
      txid: 'tx003',
      vin:  [makeVIn('prevtx', 0)],
      vout: [makeVOut(0, 49000, 'addr1')],  // 1000 sat fee
    }));

    mockClient.bulkQuery
      .mockResolvedValueOnce({
        fragments: {
          items: [{ name: 'mainnet_prevtx_0', info: prevUtxoInfo }],
          count: 1,
          allItems: true,
        },
      })
      .mockResolvedValueOnce({
        addresses: {
          items: [{ address: 'addr2', labels: { wallet: 'wallet2' } }],
          count: 1,
          allItems: true,
        },
      });

    await indexer.indexBatch(ctx, [event]);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const { transfers } = mockClient.bulkUpsert.mock.calls[0][0];

    // One transfer for wallet2 (the sender)
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ protocolId: 'tx003.wallet2', transactionHash: 'tx003' });
    expect(transfers[0].balanceChanges).toHaveLength(1);
    expect(transfers[0].balanceChanges[0]).toMatchObject({
      address: 'bitcoin_wallet2',
      amount: '50000',
      operation: 'subtract',
    });
    expect(transfers[0].from).toBe('bitcoin_wallet2');
  });

  it('creates separate transfers for sender and receiver wallets', async () => {
    const prevUtxoInfo: TxSummaryVOut = { n: 0, valueSat: 50000, scriptPubKey: { hex: '', address: 'addr2', type: 'p2pkh' } };

    const event = makeEvent(makeTxEvent({
      txid: 'tx004',
      vin:  [makeVIn('prevtx', 0)],
      vout: [makeVOut(0, 49000, 'addr1')],
    }));

    mockClient.bulkQuery
      .mockResolvedValueOnce({
        fragments: {
          items: [{ name: 'mainnet_prevtx_0', info: prevUtxoInfo }],
          count: 1,
          allItems: true,
        },
      })
      .mockResolvedValueOnce({
        addresses: {
          items: [
            { address: 'addr1', labels: { wallet: 'wallet1' } },
            { address: 'addr2', labels: { wallet: 'wallet2' } },
          ],
          count: 2,
          allItems: true,
        },
      });

    await indexer.indexBatch(ctx, [event]);

    const { transfers } = mockClient.bulkUpsert.mock.calls[0][0];

    // Two transfers: one per wallet
    expect(transfers).toHaveLength(2);

    const senderXfer = transfers.find((t: any) => t.protocolId === 'tx004.wallet2');
    expect(senderXfer.balanceChanges[0]).toMatchObject({ operation: 'subtract', amount: '50000' });

    const receiverXfer = transfers.find((t: any) => t.protocolId === 'tx004.wallet1');
    expect(receiverXfer.balanceChanges[0]).toMatchObject({ operation: 'add', amount: '49000' });
  });

  it('calls bulkUpsert once per batch', async () => {
    const events = [
      makeEvent(makeTxEvent({ txid: 'tx005', vout: [makeVOut(0, 10000, 'a1')] })),
      makeEvent(makeTxEvent({ txid: 'tx006', vout: [makeVOut(0, 20000, 'a2')] })),
    ];

    await indexer.indexBatch(ctx, events);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
  });

  it('uses valueSat over value when both are present', async () => {
    const event = makeEvent(makeTxEvent({
      txid: 'tx008',
      vout: [{ n: 0, valueSat: 99000, value: 0.001, scriptPubKey: { hex: '', type: 'p2pkh' } }],
    }));

    await indexer.indexBatch(ctx, [event]);

    const { fragments } = mockClient.bulkUpsert.mock.calls[0][0];
    expect(fragments[0].value).toBe('99000');
  });

  it('falls back to value * 1e8 when valueSat is absent', async () => {
    const event = makeEvent(makeTxEvent({
      txid: 'tx009',
      vout: [{ n: 0, value: 0.00123456, scriptPubKey: { hex: '', type: 'p2pkh' } }],
    }));

    await indexer.indexBatch(ctx, [event]);

    const { fragments } = mockClient.bulkUpsert.mock.calls[0][0];
    expect(fragments[0].value).toBe('123456');
  });
});
