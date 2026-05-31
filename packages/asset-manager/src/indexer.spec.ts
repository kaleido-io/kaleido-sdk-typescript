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
import { EventProcessorEvent, ProviderBase, RequestContext, WSEventProcessorBatchRequest, WSEventProcessorBatchResult, WSMessageType } from '@kaleido-io/workflow-engine-sdk';
import { IDataModelClient } from './bulk-upsert-builder.js';
import { Indexer, IndexerConfig } from './indexer.js';
import { ProviderAssetMgrBase } from './provider-asset-mgr-base';

interface TestConfig {
    someOption: string;
}

interface TestEvent {
    data: string;
}

const baseConfig: IndexerConfig<TestConfig> = {
    environmentNameOrId: 'e-abcde12345',
    connectorNameOrId: 's-abcde12345',
    assetManagerNameOrId: 's-abcde12345',
    providerName: 'test-provider',
    workflowEngineNameOrId: 's-abcde12345',
    platform: { url: 'https://platform.example.com' },
    config: { someOption: 'value' },
};

class TestIndexer extends Indexer<TestConfig, TestEvent> {
    setup = jest.fn<(config: TestConfig) => Promise<void>>()
        .mockResolvedValue(undefined);
    indexBatch = jest.fn<(reqContext: RequestContext, events: EventProcessorEvent<TestEvent>[]) => Promise<void>>()
        .mockResolvedValue(undefined);
}

describe('Indexer', () => {

    let mockDmClient: IDataModelClient;
    let mockWfeClient: {
        registerEventProcessor: jest.Mock;
        connect: jest.Mock;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        mockDmClient = {} as IDataModelClient;
        jest.spyOn(ProviderAssetMgrBase.prototype, 'newAssetManagerClient').mockReturnValue(mockDmClient);
        mockWfeClient = {
            registerEventProcessor: jest.fn(),
            connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        jest.spyOn(ProviderBase.prototype, 'createClient').mockResolvedValue(mockWfeClient as any);
    });

    describe('handlerName()', () => {
        it('returns "indexer" when handlerName is not configured', () => {
            const indexer = new TestIndexer(baseConfig);
            expect(indexer.handlerName()).toBe('indexer');
        });

        it('returns configured handlerName', () => {
            const indexer = new TestIndexer({ ...baseConfig, handlerName: 'my-indexer' });
            expect(indexer.handlerName()).toBe('my-indexer');
        });
    });

    describe('getConnectorServiceDetail()', () => {
        it('returns environmentNameOrId and connectorNameOrId', () => {
            const indexer = new TestIndexer(baseConfig);
            expect(indexer.getConnectorServiceDetail()).toEqual({
                environmentNameOrId: 'e-abcde12345',
                connectorNameOrId: 's-abcde12345',
            });
        });

        it('throws when environmentNameOrId is missing', () => {
            const indexer = new TestIndexer({ ...baseConfig, environmentNameOrId: undefined });
            expect(() => indexer.getConnectorServiceDetail()).toThrow('environmentNameOrId');
        });

        it('throws when connectorNameOrId is missing', () => {
            const indexer = new TestIndexer({ ...baseConfig, connectorNameOrId: undefined });
            expect(() => indexer.getConnectorServiceDetail()).toThrow('connectorNameOrId');
        });
    });

    describe('getConnectorRESTEndpoint()', () => {
        it('builds the correct REST endpoint path using kidColon transforms', () => {
            const indexer = new TestIndexer(baseConfig);
            expect(indexer.getConnectorRESTEndpoint()).toBe('/endpoint/e:abcde12345/s:abcde12345/rest');
        });
    });

    describe('ensureStream()', () => {
        let mockPut: jest.Mock;

        const validStreamConfig: IndexerConfig<TestConfig> = {
            ...baseConfig,
            stream: {
                autoCreate: true,
                factory: 'factory-1',
                name: 'my-stream',
                eventSourceConfig: { type: 'ethereum' },
                description: 'Test stream',
            },
        };

        beforeEach(() => {
            mockPut = jest.fn<() => Promise<{ data: { id: string } }>>()
                .mockResolvedValue({ data: { id: 'stream-123' } });
            jest.spyOn(ProviderBase.prototype, 'newPlatformClient').mockReturnValue({ put: mockPut } as any);
        });

        it('throws when factory is missing', async () => {
            const indexer = new TestIndexer({ ...validStreamConfig, stream: { ...validStreamConfig.stream, factory: undefined } });
            await expect(indexer.ensureStream()).rejects.toThrow('stream.factory');
        });

        it('throws when name is missing', async () => {
            const indexer = new TestIndexer({ ...validStreamConfig, stream: { ...validStreamConfig.stream, name: undefined } });
            await expect(indexer.ensureStream()).rejects.toThrow('stream.name');
        });

        it('throws when eventSourceConfig is missing', async () => {
            const indexer = new TestIndexer({ ...validStreamConfig, stream: { ...validStreamConfig.stream, eventSourceConfig: undefined } });
            await expect(indexer.ensureStream()).rejects.toThrow('stream.eventSourceConfig');
        });

        it('PUTs the stream to the correct endpoint', async () => {
            const indexer = new TestIndexer(validStreamConfig);
            await indexer.ensureStream();
            expect(mockPut).toHaveBeenCalledWith(
                '/api/v1/stream-factories/factory-1/api/streams/my-stream',
                expect.objectContaining({
                    description: 'Test stream',
                    eventProcessor: expect.objectContaining({ type: 'handler' }),
                    eventSource: expect.objectContaining({ type: 'handler' }),
                })
            );
        });

        it('includes providerName and handlerName in the stream eventProcessor', async () => {
            const indexer = new TestIndexer({ ...validStreamConfig, providerName: 'my-provider', handlerName: 'my-handler' });
            await indexer.ensureStream();
            expect(mockPut).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    eventProcessor: {
                        type: 'handler',
                        handler: { provider: 'my-provider', name: 'my-handler' },
                    },
                })
            );
        });
    });

    describe('connect()', () => {
        it('calls setup, registerEventProcessor, and connect on success', async () => {
            const indexer = new TestIndexer(baseConfig);
            await indexer.connect();
            expect(indexer.setup).toHaveBeenCalledWith(baseConfig.config!);
            expect(mockWfeClient.registerEventProcessor).toHaveBeenCalledWith('indexer', expect.anything());
            expect(mockWfeClient.connect).toHaveBeenCalled();
        });

        it('throws when config is missing', async () => {
            const indexer = new TestIndexer({ ...baseConfig, config: undefined });
            await expect(indexer.connect()).rejects.toThrow('Config is required');
        });

        it('skips ensureStream when stream.autoCreate is not set', async () => {
            const ensureStreamSpy = jest.spyOn(TestIndexer.prototype, 'ensureStream');
            const indexer = new TestIndexer(baseConfig);
            await indexer.connect();
            expect(ensureStreamSpy).not.toHaveBeenCalled();
        });

        it('calls ensureStream when stream.autoCreate is true', async () => {
            const ensureStreamSpy = jest.spyOn(TestIndexer.prototype, 'ensureStream').mockResolvedValue(undefined);
            const indexer = new TestIndexer({ ...baseConfig, stream: { autoCreate: true } });
            await indexer.connect();
            expect(ensureStreamSpy).toHaveBeenCalled();
        });

        it('uses configured handlerName when registering the event processor', async () => {
            const indexer = new TestIndexer({ ...baseConfig, handlerName: 'custom-handler' });
            await indexer.connect();
            expect(mockWfeClient.registerEventProcessor).toHaveBeenCalledWith('custom-handler', expect.anything());
        });
    });

    describe('process (via registered event processor)', () => {
        it('delegates to indexBatch with reqContext, mapped events, and dmClient', async () => {
            const indexer = new TestIndexer(baseConfig);
            await indexer.connect();

            const registeredProcessor = mockWfeClient.registerEventProcessor.mock.calls[0][1] as any;

            const reqContext: RequestContext = {
                requestId: 'req-1',
                signal: new AbortController().signal,
                cancel: () => {},
            };
            const batch: WSEventProcessorBatchRequest = {
                messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
                id: 'batch-1',
                streamName: 'my-stream',
                streamId: 'stream-id',
                events: [
                    { idempotencyKey: 'ik-1', topic: 'topic1', data: { data: 'tx-1' } },
                    { idempotencyKey: 'ik-2', topic: 'topic2', data: { data: 'tx-2' } },
                ],
            };
            const result: WSEventProcessorBatchResult = {
                messageType: WSMessageType.EVENT_PROCESSOR_BATCH_RESULT,
                id: 'batch-1',
            };

            await registeredProcessor.eventProcessorBatch(reqContext, result, batch);

            expect(indexer.indexBatch).toHaveBeenCalledWith(
                reqContext,
                [
                    { idempotencyKey: 'ik-1', topic: 'topic1', data: { data: 'tx-1' } },
                    { idempotencyKey: 'ik-2', topic: 'topic2', data: { data: 'tx-2' } },
                ],
            );
        });
    });
});
