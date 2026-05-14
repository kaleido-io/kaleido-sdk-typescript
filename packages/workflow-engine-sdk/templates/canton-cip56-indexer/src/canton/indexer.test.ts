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
import { CantonCIP56Indexer } from './indexer.js';
import type { CantonContractEvent } from './types.js';
import type {
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
} from '@kaleido-io/workflow-engine-sdk';
import type { AssetManagerClient } from '../clients/asset-manager/client.js';

function holdingInterfaceView(viewValue: Record<string, unknown>) {
  return {
    interfaceId: '718a0f77e505:Splice.Api.Token.HoldingV1:Holding',
    packageId: '718a0f77e505',
    packageName: 'splice-api-token-holding-v1',
    moduleName: 'Splice.Api.Token.HoldingV1',
    entityName: 'Holding',
    viewValue,
  };
}

function makeEvent(
  overrides: Partial<CantonContractEvent>,
): CantonContractEvent {
  return {
    eventType: 'created',
    contractId: 'contract-1',
    templateId: 'pkg-abc:Test.Token:TestHolding',
    packageId: 'pkg-abc',
    moduleName: 'Test.Token',
    entityName: 'TestHolding',
    offset: 100,
    transactionId: 'tx-1',
    workflowId: 'wf-1',
    updateId: 'upd-1',
    completionOffset: '100',
    ...overrides,
  };
}

function makeBatch(
  events: CantonContractEvent[],
): WSEventProcessorBatchRequest {
  return {
    events: events.map((e) => ({
      topic: `canton.txcomplete.${e.workflowId}`,
      data: e,
    })),
  } as WSEventProcessorBatchRequest;
}

function makeResult(): WSEventProcessorBatchResult {
  return { checkpoint: null } as unknown as WSEventProcessorBatchResult;
}

function mockAmClient() {
  return {
    bulkUpsert: vi.fn().mockResolvedValue({}),
    bulkQuery: vi.fn().mockResolvedValue({}),
  } as unknown as AssetManagerClient;
}

/** Mirror the indexer's truncateToInteger for readable assertions. */
function trunc(amount: string): string {
  return amount.split('.')[0] || '0';
}

describe('CantonCIP56Indexer', () => {
  let indexer: CantonCIP56Indexer;
  let am: ReturnType<typeof mockAmClient>;

  beforeEach(async () => {
    indexer = new CantonCIP56Indexer();
    am = mockAmClient();
    await indexer.setup(am);
  });

  it('has correct name', () => {
    expect(indexer.name()).toBe('canton-cip56-indexer');
  });

  describe('Holding created (via interface view)', () => {
    it('creates fragment, addresses, asset, pool, and balance-add transfer', async () => {
      const event = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fingerprint1',
            amount: '1000',
            instrumentId: {
              admin: 'bank::fingerprint2',
              id: 'TestInstId',
            },
            lock: null,
            meta: { values: {} },
          }),
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      expect(am.bulkUpsert).toHaveBeenCalledTimes(1);
      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(call.fragments).toHaveLength(1);
      expect(call.fragments[0]).toMatchObject({
        name: 'contract-1',
        address: 'alice::fingerprint1',
        value: trunc('1000'),
        asset: 'TestInstId',
        labels: {
          chain: 'canton',
          standard: 'CIP-56',
          instrumentId: 'TestInstId',
          owner: 'alice::fingerprint1',
          issuer: 'bank::fingerprint2',
          spent: 'false',
        },
        updateType: 'create_or_replace',
      });

      expect(call.transfers).toHaveLength(1);
      expect(call.transfers[0]).toMatchObject({
        protocolId: 'tx-1/contract-1/created',
        to: 'alice::fingerprint1',
        amount: trunc('1000'),
        transactionHash: 'tx-1',
        parent: { type: 'pool', ref: 'bank::fingerprint2/TestInstId' },
        balanceChanges: [
          { address: 'alice::fingerprint1', operation: 'add', amount: trunc('1000') },
        ],
        labels: { chain: 'canton', standard: 'CIP-56', type: 'holding_created' },
        updateType: 'create_or_replace',
      });
      expect(call.transfers[0].from).toBeUndefined();

      const addressSet = new Set(call.addresses.map((a: { address: string }) => a.address));
      expect(addressSet.has('alice::fingerprint1')).toBe(true);
      expect(addressSet.has('bank::fingerprint2')).toBe(true);

      expect(call.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'TestInstId',
            labels: expect.objectContaining({ standard: 'CIP-56' }),
          }),
        ]),
      );

      expect(call.pools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'TestInstId',
            standard: 'CIP-56',
          }),
        ]),
      );

      expect(result.checkpoint).toEqual({ offset: 100 });
    });

    it('extracts instrumentId from view', async () => {
      const event = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '500',
            instrumentId: { admin: 'bank::fp', id: 'TokenA' },
          }),
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments[0].asset).toBe('TokenA');
      expect(call.assets[0].name).toBe('TokenA');
    });

    it('defaults instrumentId to KLD when instrumentId missing', async () => {
      const event = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '500',
          }),
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments[0].asset).toBe('KLD');
      expect(call.assets[0].name).toBe('KLD');
    });

    it('truncates decimal amounts to integers', async () => {
      const event = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '33.1081975897',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments[0].value).toBe('33');
      expect(call.transfers).toHaveLength(1);
      expect(call.transfers[0].amount).toBe('33');
      expect(call.transfers[0].balanceChanges[0].amount).toBe('33');
    });

    it('lowercases party addresses to match asset-manager storage', async () => {
      const event = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'ExternalBob::1220e613f54766906abb7b8dad8e371834bc898aa67d',
            amount: '100',
            instrumentId: {
              admin: 'Admin::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8',
              id: 'TestInstId',
            },
          }),
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(call.fragments[0].address).toBe(
        'externalbob::1220e613f54766906abb7b8dad8e371834bc898aa67d',
      );
      expect(call.transfers).toHaveLength(1);
      expect(call.transfers[0].to).toBe(
        'externalbob::1220e613f54766906abb7b8dad8e371834bc898aa67d',
      );
      expect(call.transfers[0].balanceChanges[0].address).toBe(
        'externalbob::1220e613f54766906abb7b8dad8e371834bc898aa67d',
      );
      expect(call.pools[0].address).toBe(
        'admin::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8',
      );

      const allAddrs = call.addresses.map((a: { address: string }) => a.address);
      expect(allAddrs).toContain('externalbob::1220e613f54766906abb7b8dad8e371834bc898aa67d');
      expect(allAddrs).toContain('admin::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8');
    });

    it('skips events without Holding interface view', async () => {
      const event = makeEvent({
        arguments: {
          owner: 'alice::fp',
          amount: '500',
        },
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      expect(am.bulkUpsert).not.toHaveBeenCalled();
    });
  });

  describe('TransferInstruction created (via interface view)', () => {
    it('creates fragment from nested interface view without balance transfers', async () => {
      const event = makeEvent({
        contractId: 'ti-1',
        entityName: 'TransferInstruction',
        templateId: 'pkg123:Token.Transfer:TransferInstruction',
        interfaceViews: [
          {
            interfaceId: 'abc123:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
            packageId: 'abc123',
            packageName: 'splice-api-token-transfer-instruction-v1',
            moduleName: 'Splice.Api.Token.TransferInstructionV1',
            entityName: 'TransferInstruction',
            viewValue: {
              transfer: {
                sender: 'alice::fp1',
                receiver: 'bob::fp2',
                amount: '42.5',
                instrumentId: { admin: 'bank::fp3', id: 'TestInstId' },
              },
              status: { tag: 'TransferPendingReceiverAcceptance', value: {} },
            },
          },
        ],
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments).toHaveLength(1);
      expect(call.fragments[0]).toMatchObject({
        name: 'ti-1',
        address: 'alice::fp1',
        value: '42.5',
        labels: expect.objectContaining({
          chain: 'canton',
          standard: 'CIP-56',
          type: 'transfer_instruction',
          sender: 'alice::fp1',
          receiver: 'bob::fp2',
          instrumentId: 'TestInstId',
        }),
        updateType: 'create_or_replace',
      });
      expect(call.transfers).toHaveLength(0);
    });
  });

  describe('TransferInstruction created (via arguments.transfer fallback)', () => {
    it('creates fragment from arguments.transfer when no interface views', async () => {
      const event = makeEvent({
        contractId: 'to-1',
        entityName: 'TransferInstruction',
        templateId: 'pkg123:Token.Transfer:TransferInstruction',
        arguments: {
          transfer: {
            sender: 'alice::fp1',
            receiver: 'bob::fp2',
            amount: '10.0',
            instrumentId: { admin: 'bank::fp3', id: 'TestInstId' },
          },
        },
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments).toHaveLength(1);
      expect(call.fragments[0]).toMatchObject({
        name: 'to-1',
        address: 'alice::fp1',
        value: '10.0',
        displayName: 'TransferInstruction 10.0 TestInstId',
        labels: expect.objectContaining({
          chain: 'canton',
          standard: 'CIP-56',
          type: 'transfer_instruction',
          sender: 'alice::fp1',
          receiver: 'bob::fp2',
          instrumentId: 'TestInstId',
          admin: 'bank::fp3',
          spent: 'false',
        }),
        updateType: 'create_or_replace',
      });
    });

    it('caches owner from arguments.transfer and marks spent on archive', async () => {
      const createEvent = makeEvent({
        contractId: 'to-2',
        entityName: 'TransferInstruction',
        arguments: {
          transfer: {
            sender: 'alice::fp1',
            receiver: 'bob::fp2',
            amount: '5.0',
            instrumentId: { admin: 'bank::fp3', id: 'TestInstId' },
          },
        },
      });
      const archiveEvent = makeEvent({
        eventType: 'archived',
        contractId: 'to-2',
        offset: 200,
      });

      const r1 = makeResult();
      await indexer.eventProcessorBatch(r1, makeBatch([createEvent]));

      const r2 = makeResult();
      await indexer.eventProcessorBatch(r2, makeBatch([archiveEvent]));

      const archiveCall = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(archiveCall.fragments[0]).toMatchObject({
        name: 'to-2',
        address: 'alice::fp1',
        labels: { chain: 'canton', spent: 'true' },
      });
    });
  });

  describe('TransferFactory created', () => {
    it('creates pool with factory info', async () => {
      const event = makeEvent({
        entityName: 'TestTransferRules',
        arguments: { issuer: 'bank::fp' },
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.pools).toHaveLength(1);
      expect(call.pools[0]).toMatchObject({
        name: 'cip56_factory',
        standard: 'CIP-56',
        info: expect.objectContaining({
          factoryContractId: 'contract-1',
        }),
        labels: { chain: 'canton', standard: 'CIP-56', type: 'transfer_factory' },
      });
      expect(call.fragments).toHaveLength(0);
    });
  });

  describe('Archive / consuming exercise', () => {
    it('marks fragment spent and emits subtract transfer on archived event', async () => {
      const createEvent = makeEvent({
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '100',
            instrumentId: { admin: 'bank::fp', id: 'TOK' },
          }),
        ],
      });
      const archiveEvent = makeEvent({
        eventType: 'archived',
        contractId: 'contract-1',
        offset: 200,
        transactionId: 'tx-archive',
      });

      const result1 = makeResult();
      await indexer.eventProcessorBatch(result1, makeBatch([createEvent]));

      const result2 = makeResult();
      await indexer.eventProcessorBatch(result2, makeBatch([archiveEvent]));

      const archiveCall = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock
        .calls[1][0];
      expect(archiveCall.fragments).toHaveLength(1);
      expect(archiveCall.fragments[0]).toMatchObject({
        name: 'contract-1',
        address: 'alice::fp',
        labels: { chain: 'canton', spent: 'true' },
        updateType: 'create_or_update',
      });

      expect(archiveCall.transfers).toHaveLength(1);
      expect(archiveCall.transfers[0]).toMatchObject({
        protocolId: 'tx-archive/contract-1/archived',
        from: 'alice::fp',
        amount: trunc('100'),
        transactionHash: 'tx-archive',
        parent: { type: 'pool', ref: 'bank::fp/TOK' },
        balanceChanges: [
          { address: 'alice::fp', operation: 'subtract', amount: trunc('100') },
        ],
        labels: { chain: 'canton', standard: 'CIP-56', type: 'holding_archived' },
      });
      expect(archiveCall.transfers[0].to).toBeUndefined();
      expect(result2.checkpoint).toEqual({ offset: 200 });
    });

    it('marks fragment spent and emits subtract transfer on consuming exercise', async () => {
      const createEvent = makeEvent({
        contractId: 'contract-2',
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '50',
            instrumentId: { admin: 'bank::fp', id: 'TOK' },
          }),
        ],
      });
      const exerciseEvent = makeEvent({
        eventType: 'exercised',
        contractId: 'contract-2',
        consuming: true,
        choice: 'Transfer',
        offset: 300,
        transactionId: 'tx-exercise',
      });

      const result1 = makeResult();
      await indexer.eventProcessorBatch(result1, makeBatch([createEvent]));

      const result2 = makeResult();
      await indexer.eventProcessorBatch(result2, makeBatch([exerciseEvent]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(call.fragments[0]).toMatchObject({
        name: 'contract-2',
        address: 'alice::fp',
        labels: { chain: 'canton', spent: 'true' },
      });

      expect(call.transfers).toHaveLength(1);
      expect(call.transfers[0]).toMatchObject({
        protocolId: 'tx-exercise/contract-2/archived',
        from: 'alice::fp',
        amount: trunc('50'),
        parent: { type: 'pool', ref: 'bank::fp/TOK' },
        balanceChanges: [
          { address: 'alice::fp', operation: 'subtract', amount: trunc('50') },
        ],
      });
    });

    it('resolves owner via bulk AM fragment query when cache is empty', async () => {
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: {
          items: [{ name: 'orphan-contract', address: 'recovered-owner::fp' }],
        },
      });

      const archiveEvent = makeEvent({
        eventType: 'archived',
        contractId: 'orphan-contract',
        offset: 400,
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([archiveEvent]));

      expect(am.bulkQuery).toHaveBeenCalled();
      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.fragments[0]).toMatchObject({
        name: 'orphan-contract',
        address: 'recovered-owner::fp',
        labels: { chain: 'canton', spent: 'true' },
      });
      expect(call.transfers).toHaveLength(0);
    });

    it('skips archive when bulk AM query also returns nothing', async () => {
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [] },
      });

      const archiveEvent = makeEvent({
        eventType: 'archived',
        contractId: 'truly-unknown',
        offset: 500,
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([archiveEvent]));

      expect(am.bulkQuery).toHaveBeenCalled();
      expect(am.bulkUpsert).not.toHaveBeenCalled();
    });
  });

  describe('Mixed batch', () => {
    it('handles creates and archives in a single batch', async () => {
      const events = [
        makeEvent({
          contractId: 'c1',
          offset: 10,
          interfaceViews: [
            holdingInterfaceView({
              owner: 'alice::fp',
              amount: '100',
              instrumentId: { admin: 'bank::fp', id: 'TOK' },
            }),
          ],
        }),
        makeEvent({
          contractId: 'c2',
          offset: 11,
          entityName: 'TestTransferRules',
          arguments: { issuer: 'bank::fp' },
        }),
      ];

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch(events));

      expect(am.bulkUpsert).toHaveBeenCalledTimes(1);
      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(call.fragments).toHaveLength(1);
      expect(call.pools).toHaveLength(2);
      expect(call.transfers).toHaveLength(1);
      expect(result.checkpoint).toEqual({ offset: 11 });
    });

    it('create + archive in same batch produces add and subtract transfers', async () => {
      const events = [
        makeEvent({
          contractId: 'h1',
          offset: 10,
          transactionId: 'tx-create',
          interfaceViews: [
            holdingInterfaceView({
              owner: 'alice::fp',
              amount: '500',
              instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
            }),
          ],
        }),
        makeEvent({
          eventType: 'archived',
          contractId: 'h1',
          offset: 11,
          transactionId: 'tx-archive',
        }),
      ];

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch(events));

      expect(am.bulkUpsert).toHaveBeenCalledTimes(1);
      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(call.fragments).toHaveLength(1);
      expect(call.fragments[0]).toMatchObject({
        name: 'h1',
        address: 'alice::fp',
        labels: expect.objectContaining({ spent: 'true' }),
      });

      expect(call.transfers).toHaveLength(2);
      expect(call.transfers[0]).toMatchObject({
        protocolId: 'tx-create/h1/created',
        to: 'alice::fp',
        amount: trunc('500'),
        parent: { type: 'pool', ref: 'bank::fp/TestInstId' },
        balanceChanges: [
          { address: 'alice::fp', operation: 'add', amount: trunc('500') },
        ],
      });
      expect(call.transfers[1]).toMatchObject({
        protocolId: 'tx-archive/h1/archived',
        from: 'alice::fp',
        amount: trunc('500'),
        parent: { type: 'pool', ref: 'bank::fp/TestInstId' },
        balanceChanges: [
          { address: 'alice::fp', operation: 'subtract', amount: trunc('500') },
        ],
      });
    });
  });

  describe('TransferInstruction enrichment', () => {
    it('enriches Holding transfer with sender/receiver when TI exercised in same batch', async () => {
      const tiCreate = makeEvent({
        contractId: 'ti-enrich',
        entityName: 'TransferInstruction',
        transactionId: 'tx-ti-create',
        offset: 1,
        arguments: {
          transfer: {
            sender: 'alice::fp',
            receiver: 'bob::fp',
            amount: '100',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          },
        },
      });

      const r1 = makeResult();
      await indexer.eventProcessorBatch(r1, makeBatch([tiCreate]));

      const tiExercise = makeEvent({
        eventType: 'exercised',
        consuming: true,
        contractId: 'ti-enrich',
        transactionId: 'tx-accept',
        offset: 10,
      });
      const holdingCreated = makeEvent({
        contractId: 'new-holding',
        transactionId: 'tx-accept',
        offset: 11,
        interfaceViews: [
          holdingInterfaceView({
            owner: 'bob::fp',
            amount: '100',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });
      const holdingArchived = makeEvent({
        eventType: 'archived',
        contractId: 'old-holding',
        transactionId: 'tx-accept',
        offset: 12,
      });

      const oldHoldingCreate = makeEvent({
        contractId: 'old-holding',
        transactionId: 'tx-old',
        offset: 0,
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '100',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });
      await indexer.eventProcessorBatch(makeResult(), makeBatch([oldHoldingCreate]));

      const r2 = makeResult();
      await indexer.eventProcessorBatch(
        r2,
        makeBatch([tiExercise, holdingCreated, holdingArchived]),
      );

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const enrichedCall = calls[calls.length - 1][0];

      const addTransfer = enrichedCall.transfers.find(
        (t: { protocolId: string }) => t.protocolId.includes('/created'),
      );
      expect(addTransfer).toMatchObject({
        from: 'alice::fp',
        to: 'bob::fp',
        amount: trunc('100'),
        labels: { type: 'transfer' },
      });

      const subTransfer = enrichedCall.transfers.find(
        (t: { protocolId: string }) => t.protocolId.includes('/archived'),
      );
      expect(subTransfer).toMatchObject({
        from: 'alice::fp',
        to: 'bob::fp',
        amount: trunc('100'),
        labels: { type: 'transfer' },
      });
    });

    it('falls back to AM fragment query when TI not in cache (restart scenario)', async () => {
      // First bulkQuery: archive cache miss lookup (returns nothing for the exercised contract)
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: { items: [] },
      });
      // Second bulkQuery: preScan TI cache miss lookup
      (am.bulkQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        fragments: {
          items: [{
            name: 'ti-restart',
            address: 'alice::fp',
            labels: { sender: 'alice::fp', receiver: 'charlie::fp', instrumentId: 'TestInstId' },
          }],
        },
      });

      const holdingCreated = makeEvent({
        contractId: 'new-h',
        transactionId: 'tx-post-restart',
        offset: 20,
        interfaceViews: [
          holdingInterfaceView({
            owner: 'charlie::fp',
            amount: '50',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });
      const tiExercise = makeEvent({
        eventType: 'exercised',
        consuming: true,
        contractId: 'ti-restart',
        transactionId: 'tx-post-restart',
        offset: 19,
      });

      const r = makeResult();
      await indexer.eventProcessorBatch(r, makeBatch([tiExercise, holdingCreated]));

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const call = calls[calls.length - 1][0];
      const addTransfer = call.transfers.find(
        (t: { protocolId: string }) => t.protocolId.includes('/created'),
      );
      expect(addTransfer).toMatchObject({
        from: 'alice::fp',
        to: 'charlie::fp',
        labels: { type: 'transfer' },
      });
    });

    it('emits unenriched one-sided transfer when no TI context (mint/burn)', async () => {
      const holdingCreated = makeEvent({
        contractId: 'mint-holding',
        transactionId: 'tx-mint',
        offset: 5,
        interfaceViews: [
          holdingInterfaceView({
            owner: 'alice::fp',
            amount: '200',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });

      const r = makeResult();
      await indexer.eventProcessorBatch(r, makeBatch([holdingCreated]));

      const call = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.transfers).toHaveLength(1);
      expect(call.transfers[0]).toMatchObject({
        to: 'alice::fp',
        amount: trunc('200'),
        labels: { type: 'holding_created' },
      });
      expect(call.transfers[0].from).toBeUndefined();
    });

    it('cleans up TI cache on archive', async () => {
      const tiCreate = makeEvent({
        contractId: 'ti-cleanup',
        entityName: 'TransferInstruction',
        transactionId: 'tx-1',
        offset: 1,
        arguments: {
          transfer: {
            sender: 'alice::fp',
            receiver: 'bob::fp',
            amount: '10',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          },
        },
      });
      await indexer.eventProcessorBatch(makeResult(), makeBatch([tiCreate]));

      const tiArchive = makeEvent({
        eventType: 'archived',
        contractId: 'ti-cleanup',
        transactionId: 'tx-2',
        offset: 2,
      });
      await indexer.eventProcessorBatch(makeResult(), makeBatch([tiArchive]));

      const holdingCreated = makeEvent({
        contractId: 'late-holding',
        transactionId: 'tx-2',
        offset: 3,
        interfaceViews: [
          holdingInterfaceView({
            owner: 'bob::fp',
            amount: '10',
            instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
          }),
        ],
      });
      await indexer.eventProcessorBatch(makeResult(), makeBatch([holdingCreated]));

      const calls = (am.bulkUpsert as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.transfers[0].labels.type).toBe('holding_created');
      expect(lastCall.transfers[0].from).toBeUndefined();
    });
  });

  describe('Empty batch', () => {
    it('does not call bulkUpsert when no relevant events', async () => {
      const event = makeEvent({
        eventType: 'exercised',
        consuming: false,
        choice: 'SomeNonConsumingChoice',
      });

      const result = makeResult();
      await indexer.eventProcessorBatch(result, makeBatch([event]));

      expect(am.bulkUpsert).not.toHaveBeenCalled();
    });
  });
});
