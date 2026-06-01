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

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    createDirectedTransactionHandler,
    DirectedActionConfig,
    EventProcessorEvent,
    ProviderBase,
    RequestContext,
    WithStageDirector,
    WSHandleTransactions,
    WSHandleTransactionsResult,
    WSMessageType,
} from '@kaleido-io/workflow-engine-sdk';
import { IDataModelClient } from './bulk-upsert-builder.js';
import { IndexerConfig } from './indexer.js';
import { IndexerWithTxnHandler } from './indexer-with-txnhandler.js';
import { ProviderAssetMgrBase } from './provider-asset-mgr-base.js';

jest.mock('@kaleido-io/workflow-engine-sdk', () => ({
    ...(jest.requireActual('@kaleido-io/workflow-engine-sdk') as object),
    createDirectedTransactionHandler: jest.fn(),
}));

interface TestConfig { someOption: string; }
interface TestEvent { data: string; }

class TestIndexer extends IndexerWithTxnHandler<TestConfig, TestEvent> {
    getTransactionHandlerDefinition = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    indexerSetup = jest.fn<(config: TestConfig) => Promise<void>>().mockResolvedValue(undefined);
    indexBatch = jest.fn<(reqContext: RequestContext, events: EventProcessorEvent<TestEvent>[]) => Promise<void>>().mockResolvedValue(undefined);
}

const actionMap: Record<string, DirectedActionConfig<WithStageDirector>> = {};

const baseConfig: IndexerConfig<TestConfig> = {
    environmentNameOrId: 'e-abcde12345',
    assetManagerNameOrId: 's-abcde12345',
    providerName: 'test-provider',
    workflowEngineNameOrId: 's-abcde12345',
    platform: { url: 'https://platform.example.com' },
    config: { someOption: 'value' },
};

describe('IndexerWithTxnHandler', () => {

    let mockDmClient: IDataModelClient;
    let mockTxnHandler: { transactionHandlerBatch: jest.Mock };
    let mockWfeClient: {
        registerEventProcessor: jest.Mock;
        registerTransactionHandler: jest.Mock;
        connect: jest.Mock;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        mockDmClient = {} as IDataModelClient;
        jest.spyOn(ProviderAssetMgrBase.prototype, 'newAssetManagerClient').mockReturnValue(mockDmClient);
        mockTxnHandler = {
            transactionHandlerBatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        (createDirectedTransactionHandler as jest.Mock).mockReturnValue(mockTxnHandler);
        mockWfeClient = {
            registerEventProcessor: jest.fn(),
            registerTransactionHandler: jest.fn(),
            connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        jest.spyOn(ProviderBase.prototype, 'createClient').mockResolvedValue(mockWfeClient as any);
    });

    describe('constructor', () => {
        it('creates a directed transaction handler with the given name and actionMap', () => {
            new TestIndexer('my-indexer', 'my-txn-handler', actionMap, baseConfig);
            expect(createDirectedTransactionHandler).toHaveBeenCalledWith('my-txn-handler', actionMap);
        });
    });

    describe('setupWorkflowEngine() (via connect())', () => {
        it('registers both the event processor and the transaction handler', async () => {
            const indexer = new TestIndexer('my-indexer', 'my-txn-handler', actionMap, baseConfig);
            await indexer.connect();
            expect(mockWfeClient.registerEventProcessor).toHaveBeenCalledWith('my-indexer', expect.anything());
            expect(mockWfeClient.registerTransactionHandler).toHaveBeenCalledWith('my-txn-handler', mockTxnHandler);
        });

        it('registers the transaction handler with the correct name when names differ', async () => {
            const indexer = new TestIndexer('indexer-a', 'txn-handler-b', actionMap, baseConfig);
            await indexer.connect();
            expect(mockWfeClient.registerEventProcessor).toHaveBeenCalledWith('indexer-a', expect.anything());
            expect(mockWfeClient.registerTransactionHandler).toHaveBeenCalledWith('txn-handler-b', mockTxnHandler);
        });
    });

    describe('transactionHandlerBatch()', () => {
        it('delegates to the internal txnHandler', async () => {
            const indexer = new TestIndexer('my-indexer', 'my-txn-handler', actionMap, baseConfig);

            const reqContext: RequestContext = {
                requestId: 'req-1',
                signal: new AbortController().signal,
                cancel: () => {},
            };
            const result: WSHandleTransactionsResult = {
                results: [],
                messageType: WSMessageType.HANDLE_TRANSACTIONS_RESULT,
                id: 'batch-1',
            };
            const batch: WSHandleTransactions = {
                transactions: [],
                handler: 'my-txn-handler',
                messageType: WSMessageType.HANDLE_TRANSACTIONS,
                id: 'batch-1',
            };

            await indexer.transactionHandlerBatch(reqContext, result, batch);

            expect(mockTxnHandler.transactionHandlerBatch).toHaveBeenCalledWith(reqContext, result, batch);
        });
    });
});
