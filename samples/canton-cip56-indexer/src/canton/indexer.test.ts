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
import type { IndexerContext } from '@kaleido-io/workflow-engine-sdk';
import type { CantonConfig } from '../config.js';
import { CantonCIP56Indexer } from './indexer.js';
import { makeEvent, wrapEvents, mockAmClient, mockIndexerContext, holdingInterfaceView } from './test-helpers.js';

vi.mock('@kaleido-io/asset-manager-sdk', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, AssetManagerClient: vi.fn() };
});

describe('CantonCIP56Indexer (integration)', () => {
  let indexer: CantonCIP56Indexer;
  let am: ReturnType<typeof mockAmClient>;
  let ctx: IndexerContext<CantonConfig>;

  beforeEach(() => {
    indexer = new CantonCIP56Indexer();
    am = mockAmClient();
    ctx = mockIndexerContext(am);
  });

  it('returns the input events from indexBatch', async () => {
    const event = makeEvent({
      offset: 42,
      interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '1', instrumentId: { id: 'TOK', admin: 'b::fp' } })],
    });
    const result = await indexer.indexBatch(ctx, wrapEvents([event]));
    expect(result.events).toHaveLength(1);
  });

  it('does not call bulkUpsert when no relevant events', async () => {
    const event = makeEvent({
      eventType: 'exercised',
      consuming: false,
      choice: 'SomeNonConsumingChoice',
    });
    await indexer.indexBatch(ctx, wrapEvents([event]));
    expect(am.bulkUpsert).not.toHaveBeenCalled();
  });

  it('skips events without Holding interface view and no TI data', async () => {
    const event = makeEvent({ arguments: { owner: 'alice::fp', amount: '500' } });
    await indexer.indexBatch(ctx, wrapEvents([event]));
    expect(am.bulkUpsert).not.toHaveBeenCalled();
  });

  describe('end-to-end Holding flow', () => {
    it('upserts fragment, transfer, addresses, asset, pool via bulkUpsert', async () => {
      const event = makeEvent({
        interfaceViews: [holdingInterfaceView({
          owner: 'alice::fp', amount: '1000',
          instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
        })],
      });

      await indexer.indexBatch(ctx, wrapEvents([event]));

      expect(am.bulkUpsert).toHaveBeenCalledTimes(1);
      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments).toHaveLength(1);
      expect(call.transfers).toHaveLength(1);
      expect(call.assets.length).toBeGreaterThan(0);
      expect(call.pools.length).toBeGreaterThan(0);
      expect(call.addresses.length).toBeGreaterThan(0);
    });
  });

  describe('mixed batch', () => {
    it('handles multiple creates in a single batch', async () => {
      const events = [
        makeEvent({
          contractId: 'c1', offset: 10,
          interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '100', instrumentId: { admin: 'bank::fp', id: 'TOK' } })],
        }),
        makeEvent({
          contractId: 'c2', offset: 11,
          interfaceViews: [holdingInterfaceView({ owner: 'bob::fp', amount: '200', instrumentId: { admin: 'bank::fp', id: 'TOK' } })],
        }),
      ];

      await indexer.indexBatch(ctx, wrapEvents(events));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments).toHaveLength(2);
      expect(call.pools).toHaveLength(1);
      expect(call.transfers).toHaveLength(2);
    });

    it('create + archive in same batch produces add and subtract transfers', async () => {
      const events = [
        makeEvent({
          contractId: 'h1', offset: 10, transactionId: 'tx-create',
          interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '500', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
        }),
        makeEvent({ eventType: 'archived', contractId: 'h1', offset: 11, transactionId: 'tx-archive' }),
      ];

      await indexer.indexBatch(ctx, wrapEvents(events));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments).toHaveLength(1);
      expect(call.fragments[0].labels).toMatchObject({ spent: 'true' });
      expect(call.transfers).toHaveLength(2);
      expect(call.transfers[0].protocolId).toContain('/created');
      expect(call.transfers[1].protocolId).toContain('/archived');
    });
  });

  describe('archive via AM query (cross-batch)', () => {
    it('resolves contract from AM when archive is in a separate batch', async () => {
      const createEvent = makeEvent({
        interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '100', instrumentId: { admin: 'bank::fp', id: 'TOK' } })],
      });
      await indexer.indexBatch(ctx, wrapEvents([createEvent]));

      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [{ name: 'contract-1', address: 'alice::fp', value: '1000000000000', labels: { issuer: 'bank::fp', instrumentId: 'TOK' } }] },
      });

      const archiveEvent = makeEvent({ eventType: 'archived', contractId: 'contract-1', offset: 200, transactionId: 'tx-archive' });
      await indexer.indexBatch(ctx, wrapEvents([archiveEvent]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(call.fragments[0]).toMatchObject({ name: 'contract-1', labels: { spent: 'true' } });
      expect(call.transfers[0]).toMatchObject({ from: 'alice::fp', amount: '1000000000000' });
    });

    it('resolves owner via AM query when contract is fully unknown', async () => {
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [{ name: 'orphan-contract', address: 'recovered-owner::fp' }] },
      });

      const archiveEvent = makeEvent({ eventType: 'archived', contractId: 'orphan-contract', offset: 400 });
      await indexer.indexBatch(ctx, wrapEvents([archiveEvent]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments[0]).toMatchObject({ name: 'orphan-contract', address: 'recovered-owner::fp' });
    });

    it('skips archive when AM query returns nothing', async () => {
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ fragments: { items: [] } });
      const archiveEvent = makeEvent({ eventType: 'archived', contractId: 'truly-unknown', offset: 500 });
      await indexer.indexBatch(ctx, wrapEvents([archiveEvent]));
      expect(am.bulkUpsert).not.toHaveBeenCalled();
    });

    it('marks TI spent on archive via AM query (cross-batch)', async () => {
      const createEvent = makeEvent({
        contractId: 'to-2', entityName: 'TransferInstruction',
        arguments: { transfer: { sender: 'alice::fp1', receiver: 'bob::fp2', amount: '5.0', instrumentId: { admin: 'bank::fp3', id: 'TestInstId' } } },
      });
      await indexer.indexBatch(ctx, wrapEvents([createEvent]));

      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [{ name: 'to-2', address: 'alice::fp1' }] },
      });

      const archiveEvent = makeEvent({ eventType: 'archived', contractId: 'to-2', offset: 200 });
      await indexer.indexBatch(ctx, wrapEvents([archiveEvent]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(call.fragments[0]).toMatchObject({ name: 'to-2', labels: { spent: 'true' } });
    });
  });

  describe('TransferInstruction enrichment', () => {
    it('enriches Holding transfers with sender/receiver when TI exercised (AM fallback)', async () => {
      const tiCreate = makeEvent({
        contractId: 'ti-enrich', entityName: 'TransferInstruction', transactionId: 'tx-ti-create', offset: 1,
        arguments: { transfer: { sender: 'alice::fp', receiver: 'bob::fp', amount: '100', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } } },
      });
      await indexer.indexBatch(ctx, wrapEvents([tiCreate]));

      const oldHolding = makeEvent({
        contractId: 'old-holding', transactionId: 'tx-old', offset: 0,
        interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '100', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
      });
      await indexer.indexBatch(ctx, wrapEvents([oldHolding]));

      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [
          { name: 'ti-enrich', address: 'alice::fp', labels: { sender: 'alice::fp', receiver: 'bob::fp', instrumentId: 'TestInstId', type: 'transfer_instruction' } },
          { name: 'old-holding', address: 'alice::fp', value: '1000000000000', labels: { issuer: 'bank::fp', instrumentId: 'TestInstId', type: 'holding' } },
        ] },
      });

      const tiExercise = makeEvent({ eventType: 'exercised', consuming: true, contractId: 'ti-enrich', transactionId: 'tx-accept', offset: 10 });
      const holdingCreated = makeEvent({
        contractId: 'new-holding', transactionId: 'tx-accept', offset: 11,
        interfaceViews: [holdingInterfaceView({ owner: 'bob::fp', amount: '100', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
      });
      const holdingArchived = makeEvent({ eventType: 'archived', contractId: 'old-holding', transactionId: 'tx-accept', offset: 12 });

      await indexer.indexBatch(ctx, wrapEvents([tiExercise, holdingCreated, holdingArchived]));

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const enrichedCall = calls[calls.length - 1][0];

      const addTransfer = enrichedCall.transfers.find((t: { protocolId: string }) => t.protocolId.includes('/created'));
      expect(addTransfer).toMatchObject({ from: 'alice::fp', to: 'bob::fp', labels: { type: 'transfer' } });

      const subTransfer = enrichedCall.transfers.find((t: { protocolId: string }) => t.protocolId.includes('/archived'));
      expect(subTransfer).toMatchObject({ from: 'alice::fp', to: 'bob::fp', labels: { type: 'transfer' } });
    });

    it('falls back to AM fragment query when TI not in cache (restart scenario)', async () => {
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [{ name: 'ti-restart', address: 'alice::fp', labels: { sender: 'alice::fp', receiver: 'charlie::fp', instrumentId: 'TestInstId' } }] },
      });

      const tiExercise = makeEvent({ eventType: 'exercised', consuming: true, contractId: 'ti-restart', transactionId: 'tx-post-restart', offset: 19 });
      const holdingCreated = makeEvent({
        contractId: 'new-h', transactionId: 'tx-post-restart', offset: 20,
        interfaceViews: [holdingInterfaceView({ owner: 'charlie::fp', amount: '50', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
      });

      await indexer.indexBatch(ctx, wrapEvents([tiExercise, holdingCreated]));

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const call = calls[calls.length - 1][0];
      const addTransfer = call.transfers.find((t: { protocolId: string }) => t.protocolId.includes('/created'));
      expect(addTransfer).toMatchObject({ from: 'alice::fp', to: 'charlie::fp', labels: { type: 'transfer' } });
    });

    it('emits unenriched transfer when no TI context (mint)', async () => {
      const holdingCreated = makeEvent({
        contractId: 'mint-holding', transactionId: 'tx-mint', offset: 5,
        interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '200', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
      });
      await indexer.indexBatch(ctx, wrapEvents([holdingCreated]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.transfers[0]).toMatchObject({ to: 'alice::fp', labels: { type: 'holding_created' } });
      expect(call.transfers[0].from).toBeUndefined();
    });

    it('does not enrich holdings after TI is archived (not exercised)', async () => {
      const tiCreate = makeEvent({
        contractId: 'ti-cleanup', entityName: 'TransferInstruction', transactionId: 'tx-1', offset: 1,
        arguments: { transfer: { sender: 'alice::fp', receiver: 'bob::fp', amount: '10', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } } },
      });
      await indexer.indexBatch(ctx, wrapEvents([tiCreate]));

      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [{ name: 'ti-cleanup', address: 'alice::fp' }] },
      });
      const tiArchive = makeEvent({ eventType: 'archived', contractId: 'ti-cleanup', transactionId: 'tx-2', offset: 2 });
      await indexer.indexBatch(ctx, wrapEvents([tiArchive]));

      const holdingCreated = makeEvent({
        contractId: 'late-holding', transactionId: 'tx-2', offset: 3,
        interfaceViews: [holdingInterfaceView({ owner: 'bob::fp', amount: '10', instrumentId: { admin: 'bank::fp', id: 'TestInstId' } })],
      });
      await indexer.indexBatch(ctx, wrapEvents([holdingCreated]));

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.transfers[0].labels.type).toBe('holding_created');
      expect(lastCall.transfers[0].from).toBeUndefined();
    });
  });
});
