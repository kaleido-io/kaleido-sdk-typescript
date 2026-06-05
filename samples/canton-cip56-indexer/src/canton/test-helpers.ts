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

import { vi } from 'vitest';
import type { CantonContractEvent, BatchContext, TransferContext, ContractInfo } from './types.js';
import type {
  EventProcessorEvent,
  IDataModelClient,
  IndexerContext,
} from '@kaleido-io/sdk';
import { AssetManagerClient } from '@kaleido-io/sdk';
import type {
  AddressBulkInput as Address,
  AssetBulkInput as Asset,
  FragmentBulkInput as Fragment,
  PoolBulkInput as Pool,
  TransferBulkInput as Transfer,
} from '@kaleido-io/sdk';
import type { CantonConfig } from '../config.js';

export function mockIndexerContext(am: IDataModelClient): IndexerContext<CantonConfig> {
  const amClient = am as unknown as AssetManagerClient;
  return {
    config: {},
    providerName: 'test-provider',
    handlerName: 'canton-cip56-indexer',
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    assetManagerClient: () => amClient,
    getServiceClientOptions: vi.fn() as any,
    get am() { return amClient; },
  };
}

export function holdingInterfaceView(viewValue: Record<string, unknown>) {
  return {
    interfaceId: '718a0f77e505:Splice.Api.Token.HoldingV1:Holding',
    packageId: '718a0f77e505',
    packageName: 'splice-api-token-holding-v1',
    moduleName: 'Splice.Api.Token.HoldingV1',
    entityName: 'Holding',
    viewValue,
  };
}

export function makeEvent(
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

export function wrapEvents(
  events: CantonContractEvent[],
): EventProcessorEvent<CantonContractEvent>[] {
  return events.map((e, i) => ({
    idempotencyKey: `key-${i}`,
    topic: `canton.txcomplete.${e.workflowId}`,
    data: e,
  }));
}

export function mockAmClient(): IDataModelClient {
  return {
    bulkUpsert: vi.fn().mockResolvedValue({}),
    bulkQuery: vi.fn().mockResolvedValue({}),
  } as unknown as IDataModelClient;
}

export function makeBatchContext(overrides?: Partial<BatchContext>): BatchContext {
  const addressMap = new Map<string, Address>();
  return {
    fragmentMap: new Map<string, Fragment>(),
    transfers: [] as Transfer[],
    addressMap,
    assetMap: new Map<string, Asset>(),
    poolMap: new Map<string, Pool>(),
    addressSet: new Set<string>(),
    txContext: new Map<string, TransferContext>(),
    contracts: new Map<string, ContractInfo>(),
    addAddress: (addr: Address) => {
      const role = (addr.info as Record<string, unknown>)?.role ?? '';
      const key = `${addr.address}:${role}`;
      if (!addressMap.has(key)) addressMap.set(key, addr);
    },
    ...overrides,
  };
}
