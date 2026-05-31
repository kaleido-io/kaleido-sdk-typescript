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

import { IndexerConfig, ProviderAssetMgrBase } from '@kaleido-io/asset-manager-sdk';
import type { EventProcessorEvent, RequestContext } from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEvent } from '@kaleido-io/workflow-engine-sdk/types/evm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ETHIndexerConfig } from './config.js';
import { ETHIndexer } from './indexer.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NETWORK = { name: 'sepolia', chainId: 11155111 };

const ETH_CONFIG: ETHIndexerConfig = {
  chainId:    String(NETWORK.chainId),
  networkName:  NETWORK.name,
  tokenName:   'eth-sepolia',
  tokenSymbol: 'ETH',
};

const MOCK_INDEXER_CONFIG: IndexerConfig<ETHIndexerConfig> = {
    platform: { url: 'http://unused.example.com' },
    environmentNameOrId: 'test-env', assetManagerNameOrId: 'test-am',
    config: ETH_CONFIG,
}

const mockReqContext: RequestContext = {
  requestId: 'test-request-id',
  signal: new AbortController().signal,
  cancel: () => {},
};

const exampleEvent = {
  "idempotencyKey": "s-i63d201h0j.evm/11155111/block/2630433/0x6768e17315a43a01d775039daebc95008f61f35f21eb866c8f8f39aff5feadce/tx/1/0x59c8f66edfdd68e2e54b6d5ce6aa5923d8aa3063560cf96cbe19734cc5c5374f",
  "topic": "s-i63d201h0j.evm.11155111.transactions.0x59c8f66edfdd68e2e54b6d5ce6aa5923d8aa3063560cf96cbe19734cc5c5374f",
  "data": {
    "block": {
      "hash": "0x6768e17315a43a01d775039daebc95008f61f35f21eb866c8f8f39aff5feadce",
      "number": "2630433",
      "parentHash": "0x76d3fc9af2f7002bc1535cb2da22167a76d946fa250d5ac06f0f82ba905b3938",
      "timestamp": "1672996548"
    },
    "chainId": "11155111",
    "decodedEvents": [],
    "ethTransfers": [
      {
        "from": "0xe276bc378a527a8792b353cdca5b5e53263dfb9e",
        "to": "0x3e644b1e792e334ea518fa1115d5d62a70cbf5fe",
        "traceAddress": [],
        "value": "1000000000000000000000"
      }
    ],
    "receipt": {
      "blockHash": "0x6768e17315a43a01d775039daebc95008f61f35f21eb866c8f8f39aff5feadce",
      "blockNumber": "2630433",
      "contractAddress": null,
      "cumulativeGasUsed": "61002",
      "effectiveGasPrice": "1500000007",
      "from": "0xe276bc378a527a8792b353cdca5b5e53263dfb9e",
      "gasUsed": "21000",
      "status": "1",
      "to": "0x3e644b1e792e334ea518fa1115d5d62a70cbf5fe",
      "transactionHash": "0x59c8f66edfdd68e2e54b6d5ce6aa5923d8aa3063560cf96cbe19734cc5c5374f",
      "transactionIndex": "1",
      "type": "2"
    },
    "transactionHash": "0x59c8f66edfdd68e2e54b6d5ce6aa5923d8aa3063560cf96cbe19734cc5c5374f"
  }
};

function makeTxEvent(overrides: Record<string, unknown> = {}): EVMTransactionEvent {
  return { ...exampleEvent.data, ...overrides } as unknown as EVMTransactionEvent;
}

function makeEvent(data: EVMTransactionEvent): EventProcessorEvent<EVMTransactionEvent> {
  return { idempotencyKey: exampleEvent.idempotencyKey, topic: exampleEvent.topic, data };
}

type MockClient = { bulkUpsert: ReturnType<typeof vi.fn>; bulkQuery: ReturnType<typeof vi.fn> };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ETHIndexer.setup()', () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = { bulkUpsert: vi.fn().mockResolvedValue({}), bulkQuery: vi.fn() };
    vi.spyOn(ProviderAssetMgrBase.prototype, 'newAssetManagerClient').mockReturnValue(mockClient as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it('upserts asset, address, and pool with create_or_ignore', async () => {
    const indexer = new ETHIndexer(MOCK_INDEXER_CONFIG);
    await indexer.setup(ETH_CONFIG);

    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const payload = mockClient.bulkUpsert.mock.calls[0][0];

    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toMatchObject({ name: 'eth-sepolia', updateType: 'create_or_ignore' });

    expect(payload.addresses).toHaveLength(1);
    expect(payload.addresses[0]).toMatchObject({ address: 'eth-sepolia', contract: true, updateType: 'create_or_ignore' });

    expect(payload.pools).toHaveLength(1);
    expect(payload.pools[0]).toMatchObject({ name: 'eth-sepolia', asset: 'eth-sepolia', standard: 'eth', updateType: 'create_or_ignore' });
  });
});

describe('ETHIndexer.process()', () => {
  let mockClient: MockClient;
  let indexer: ETHIndexer;

  beforeEach(async () => {
    mockClient = {
      bulkUpsert: vi.fn().mockResolvedValue({}),
      bulkQuery:  vi.fn().mockResolvedValue({
        fragments: { items: [], count: 0, allItems: true },
        addresses: { items: [], count: 0, allItems: true },
      }),
    };
    vi.spyOn(ProviderAssetMgrBase.prototype, 'newAssetManagerClient').mockReturnValue(mockClient as any);
    indexer = new ETHIndexer(MOCK_INDEXER_CONFIG);
    await indexer.setup(ETH_CONFIG);
    vi.clearAllMocks();
  });

  it('makes no calls for an empty batch', async () => {
    await indexer.indexBatch(mockReqContext, []);
    expect(mockClient.bulkUpsert).not.toHaveBeenCalled();
    expect(mockClient.bulkQuery).not.toHaveBeenCalled();
  });

  it('throws on chain id mismatch', async () => {
    const event = makeEvent(makeTxEvent({ chainId: '99999' }));
    await expect(indexer.indexBatch(mockReqContext, [event])).rejects.toThrow(/Network mismatch/);
  });

  it('upserts a transfer for each ETH transfer in the event', async () => {
    const event = makeEvent(makeTxEvent());

    await indexer.indexBatch(mockReqContext, [event]);

    expect(mockClient.bulkQuery).not.toHaveBeenCalled();
    expect(mockClient.bulkUpsert).toHaveBeenCalledTimes(1);
    const { transfers } = mockClient.bulkUpsert.mock.calls[0][0];

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      updateType: 'create_or_ignore',
      protocolId: exampleEvent.data.transactionHash,
      from: '0xe276bc378a527a8792b353cdca5b5e53263dfb9e',
      to: '0x3e644b1e792e334ea518fa1115d5d62a70cbf5fe',
      amount: '1000000000000000000000',
      balanceChanges: expect.arrayContaining([
        expect.objectContaining({ address: 'eth-sepolia_0xe276bc378a527a8792b353cdca5b5e53263dfb9e', operation: 'subtract' }),
        expect.objectContaining({ address: 'eth-sepolia_0x3e644b1e792e334ea518fa1115d5d62a70cbf5fe', operation: 'add' }),
      ]),
      parent: { type: 'pool', ref: 'eth-sepolia/eth-sepolia' },
    });
  });

});
