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


import { describe, it, expect, jest } from '@jest/globals';

//quietens the console during tests
import '../../tests/mock-logger';

import { EventSourceConf, newEventSource } from './event_source';
import { WSEventSourceConfig, WSListenerPollRequest, WSListenerPollResult, WSHandlerEnvelope, WSMessageType, WSEventStreamInfo } from '../types/core';
import { EngineClient, EngineClientRuntime } from '../runtime/engine_client';

// Define test types
interface TestCheckpoint {
    lastId: number;
}

interface TestConfig {
    endpoint: string;
}

interface TestEventData {
    id: number;
    message: string;
}

describe('newEventSource', () => {

    it('should create an event source', () => {
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)

        expect(eventSource).toBeDefined();
        expect(eventSource.name()).toBe('test-event-source');
    })

    it('should create an event source with init and close functions', async () => {
        const initFn = jest.fn(() => Promise.resolve());
        const closeFn = jest.fn();
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const engineClientRuntime = {
            sendMessage: jest.fn(),
            getActiveHandlerContext: jest.fn(() => ({ requestId: 'test', authTokens: { 'test': 'test' } })),
            isWebSocketConnected: jest.fn(() => true),
            generateId: jest.fn(() => 'test'),
        } as any as EngineClientRuntime;
        const engineClient = new EngineClient(engineClientRuntime);
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withInitFn(initFn)
            .withCloseFn(closeFn);
        await eventSource.init(engineClient);
        expect(initFn).toHaveBeenCalledTimes(1);
        eventSource.close();
        expect(closeFn).toHaveBeenCalledTimes(1);
    })

    it('should poll for events', async () => {
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 5 },
                events: [
                    { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, message: 'test1' } },
                    { idempotencyKey: 'key2', topic: 'test-topic', data: { id: 2, message: 'test2' } }
                ]
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn);

        const config: WSEventSourceConfig = {
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'config-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { endpoint: 'http://test.com' }
        };

        const result: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id',
            handler: 'test-event-source',
            events: []
        };

        const request: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            checkpoint: { lastId: 0 }
        };

        await eventSource.eventSourcePoll(config, result, request);

        expect(pollFn).toHaveBeenCalledTimes(1);
        expect(result.events).toHaveLength(2);
        expect(result.events[0].idempotencyKey).toBe('key1');
        expect(result.events[0].topic).toBe('test-topic');
        expect(result.events[0].data).toEqual({ id: 1, message: 'test1' });
        expect(result.checkpoint).toEqual({ lastId: 5 });
    })

    it('should handle poll with null checkpoint', async () => {
        const pollFn = jest.fn(async (_config, checkpointIn) => {
            expect(checkpointIn).toBeNull();
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn);

        const config: WSEventSourceConfig = {
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'config-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { endpoint: 'http://test.com' }
        };

        const result: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id',
            handler: 'test-event-source',
            events: []
        };

        const request: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourcePoll(config, result, request);
        expect(pollFn).toHaveBeenCalledTimes(1);
    })

    it('should handle poll errors', async () => {
        const pollFn = jest.fn(async () => {
            throw new Error('Poll failed');
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn);

        const config: WSEventSourceConfig = {
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'config-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { endpoint: 'http://test.com' }
        };

        const result: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id',
            handler: 'test-event-source',
            events: []
        };

        const request: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourcePoll(config, result, request);
        expect(result.error).toBe('Poll failed');
    })

    it('should validate config', async () => {
        const buildInitialCheckpointFn = jest.fn(async () => {
            return { lastId: 0 };
        });
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withInitialCheckpoint(buildInitialCheckpointFn);

        const result: WSHandlerEnvelope = {
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG_RESULT,
            id: 'validate-id',
            handler: 'test-event-source'
        };

        const request: any = {
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'validate-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { endpoint: 'http://test.com' }
        };

        await eventSource.eventSourceValidateConfig(result, request);
        expect(buildInitialCheckpointFn).toHaveBeenCalledTimes(1);
        expect(buildInitialCheckpointFn).toHaveBeenCalled();
    })

    it('should handle config validation errors', async () => {
        const configParserFn = jest.fn(async () => {
            throw new Error('Invalid config');
        });
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withConfigParser(configParserFn);

        const result: WSHandlerEnvelope = {
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG_RESULT,
            id: 'validate-id',
            handler: 'test-event-source'
        };

        const request: any = {
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'validate-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { invalid: 'config' }
        };

        await eventSource.eventSourceValidateConfig(result, request);
        expect(result.error).toBe('Invalid config');
    })

    it('should use custom config parser', async () => {
        const configParserFn = jest.fn(async (info: WSEventStreamInfo, configData: any) => {
            return { endpoint: configData.url };
        });
        const pollFn = jest.fn(async (config: EventSourceConf<TestConfig>) => {
            expect(config.config.endpoint).toBe('http://parsed.com');
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withConfigParser(configParserFn);

        const config: WSEventSourceConfig = {
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'config-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { url: 'http://parsed.com' }
        };

        const result: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id',
            handler: 'test-event-source',
            events: []
        };

        const request: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourcePoll(config, result, request);
        expect(configParserFn).toHaveBeenCalledTimes(1);
    })

    it('should delete event source', async () => {
        const deleteFn = jest.fn(async (info: WSEventStreamInfo) => {
            expect(info.streamId).toBe('stream-1');
            expect(info.streamName).toBe('test-stream');
        });
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withDeleteFn(deleteFn);

        const result: WSHandlerEnvelope = {
            messageType: WSMessageType.EVENT_SOURCE_DELETE_RESULT,
            id: 'delete-id',
            handler: 'test-event-source'
        };

        const request: any = {
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'delete-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourceDelete(result, request);
        expect(deleteFn).toHaveBeenCalledTimes(1);
    })

    it('should handle delete errors', async () => {
        const deleteFn = jest.fn(async () => {
            throw new Error('Delete failed');
        });
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn)
            .withDeleteFn(deleteFn);

        const result: WSHandlerEnvelope = {
            messageType: WSMessageType.EVENT_SOURCE_DELETE_RESULT,
            id: 'delete-id',
            handler: 'test-event-source'
        };

        const request: any = {
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'delete-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourceDelete(result, request);
        expect(result.error).toBe('Delete failed');
    })

    it('should cache config between polls', async () => {
        const pollFn = jest.fn(async () => {
            return {
                checkpointOut: { lastId: 0 },
                events: []
            };
        });
        const eventSource = newEventSource<TestCheckpoint, TestConfig, TestEventData>('test-event-source', pollFn);

        const config: WSEventSourceConfig = {
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'config-id',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1',
            config: { endpoint: 'http://test.com' }
        };

        const result1: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id-1',
            handler: 'test-event-source',
            events: []
        };

        const request1: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id-1',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        await eventSource.eventSourcePoll(config, result1, request1);

        const result2: WSListenerPollResult = {
            messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
            id: 'poll-id-2',
            handler: 'test-event-source',
            events: []
        };

        const request2: WSListenerPollRequest = {
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'poll-id-2',
            handler: 'test-event-source',
            streamName: 'test-stream',
            streamId: 'stream-1'
        };

        // Second poll should use cached config, so we don't pass config again
        await eventSource.eventSourcePoll(config, result2, request2);

        // Poll function should be called twice, but config should be cached
        expect(pollFn).toHaveBeenCalledTimes(2);
    })
})