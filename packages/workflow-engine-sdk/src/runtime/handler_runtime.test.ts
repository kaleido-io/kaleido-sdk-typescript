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


import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';

import { mockLogger } from '../../tests/mock-logger';

const mockEngineClient = {
    submitAsyncTransactions: jest.fn(),
    handleResponse: jest.fn(),
} as any as EngineClient;

jest.mock('./engine_client', () => ({
    EngineClient: jest.fn(() => mockEngineClient)
}));

import { HandlerRuntime, HandlerRuntimeConfig, HandlerRuntimeMode } from './handler_runtime';
import { EngineClient } from './engine_client';
import { EventProcessor, EventSource, TransactionHandler } from '../interfaces/handlers';
import { WSEventProcessorBatchRequest, WSMessageType } from '../types/core';

const handlerRuntimeConfig: HandlerRuntimeConfig = {
    providerName: 'test-provider',
    providerMetadata: { version: '1.0.0' },
    authToken: 'test-token',
    authHeaderName: 'Authorization'
};

const heartbeatConfig: HandlerRuntimeConfig = {
    ...handlerRuntimeConfig,
    pingIntervalMs: 10, // 10ms for very fast testing
    pongTimeoutMs: 5, // 5ms for very fast testing
    maxAttempts: 1, // Don't retry to avoid timeouts
};

const mockTransactionHandler: TransactionHandler = {
    name: () => 'test-transaction-handler',
    init: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    transactionHandlerBatch: jest.fn(() => Promise.resolve()),
};

const mockTransactionHandlerError: TransactionHandler = {
    name: () => 'test-transaction-handler-error',
    init: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    transactionHandlerBatch: jest.fn(() => Promise.reject(new Error('test-error'))),
};

const mockEventProcessor: EventProcessor = {
    name: () => 'test-event-processor',
    init: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    eventProcessorBatch: jest.fn(() => Promise.resolve()),
};

const mockEventProcessorError: EventProcessor = {
    name: () => 'test-event-processor-error',
    init: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    eventProcessorBatch: jest.fn(() => Promise.reject(new Error('event-processor-error'))),
};

const mockEventSource: EventSource = {
    name: () => 'test-event-source',
    init: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    eventSourcePoll: jest.fn(() => Promise.resolve()),
    eventSourceValidateConfig: jest.fn(() => Promise.resolve()),
    eventSourceDelete: jest.fn(() => Promise.resolve()),
};

describe('HandlerRuntime', () => {
    jest.setTimeout(20000); // 20 seconds
    let handlerRuntime: HandlerRuntime;
    let httpServer: ReturnType<typeof createServer>;
    let wss: WebSocketServer;
    let connectedSocket: WebSocket | undefined;
    let request: IncomingMessage;
    let wsPort: number;
    let wsUrl: string;
    let mockShouldRespondToPings: boolean;
    let pingReceived: boolean;
    let ignoredPing: boolean;

    beforeAll((done) => {
        // Create HTTP server
        httpServer = createServer();

        // Create WebSocket server
        wss = new WebSocketServer({ server: httpServer, autoPong: false });

        // Handle WebSocket connections
        wss.on('connection', (ws, req) => {
            connectedSocket = ws;
            request = req;

            // Handle incoming messages
            ws.on('message', (data, isBinary: boolean) => {
                ws.send(isBinary ? data : data.toString());
            });

            ws.on('close', () => {
                connectedSocket = undefined;
            });

            ws.removeAllListeners('ping');
            ws.on('ping', async (data) => {
                pingReceived = true;
                if (mockShouldRespondToPings) {
                    ws.pong(data);
                } else {
                    ignoredPing = true;
                }
            });

            ws.on('error', () => {
                // Handle errors silently
            });
        });

        // Start server on random port
        httpServer.listen(0, () => {
            const address = httpServer.address();
            if (address && typeof address === 'object') {
                wsPort = address.port;
                wsUrl = `ws://localhost:${wsPort}/ws`;
            }
            // Set up the config with the actual server URL
            handlerRuntimeConfig.url = wsUrl;
            heartbeatConfig.url = wsUrl;
            done();
        });
    });

    afterAll((done) => {
        wss.close(() => {
            httpServer.close(() => {
                done();
            });
        });
        handlerRuntime?.stop();
        connectedSocket?.close();
    });

    beforeEach(() => {
        pingReceived = false;
        mockShouldRespondToPings = true; // Default to responding to pings
        ignoredPing = false;
    });

    afterEach(() => {
        handlerRuntime?.stop();
        connectedSocket?.close();
        mockLogger.warn.mockClear();
        mockLogger.error.mockClear();
        mockLogger.info.mockClear();
        mockLogger.debug.mockClear();
        mockShouldRespondToPings = true; // Reset flag
        pingReceived = false;
        ignoredPing = false;
        delete process.env.WORKFLOW_ENGINE_MODE;
        delete process.env.WEBSOCKET_PORT;
    })

    it('should create a handler runtime', () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        expect(handlerRuntime).toBeDefined();
    })
    it('should create a handler runtime and propagate optional headers', async () => {
        const config = { ...handlerRuntimeConfig }
        config.options = {
            headers: {
                'Custom-Header': 'value'
            }
        }
        handlerRuntime = new HandlerRuntime(config);
        expect(handlerRuntime).toBeDefined();
        await handlerRuntime.start();
        // Wait a bit for the connection to establish and handlers to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        expect(request.headers['custom-header']).toEqual('value');
        handlerRuntime.stop();
    })
    it('should register handlers', () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.registerEventProcessor('test-event-processor', mockEventProcessor);
        expect(handlerRuntime.getAllHandlers()).toEqual([mockTransactionHandler, mockEventSource, mockEventProcessor]);
    })
    it('should initialize the handlers on start', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.registerEventProcessor('test-event-processor', mockEventProcessor);
        await handlerRuntime.start();
        // Wait a bit for the connection to establish and handlers to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        handlerRuntime.stop();
        expect(mockTransactionHandler.init).toHaveBeenCalledTimes(1);
        expect(mockEventSource.init).toHaveBeenCalledTimes(1);
        expect(mockEventProcessor.init).toHaveBeenCalledTimes(1);
    })
    it('should default the auth header', async () => {
        const config = { ...handlerRuntimeConfig }
        delete config.authHeaderName;
        handlerRuntime = new HandlerRuntime(config);
        await handlerRuntime.start();
        handlerRuntime.stop();
        expect(request.headers['authorization']).toEqual('test-token');
    })
    it('should fail to start without a URL', async () => {
        const config = { ...handlerRuntimeConfig }
        delete config.url;
        config.maxAttempts = 1;
        handlerRuntime = new HandlerRuntime(config);
        await expect(handlerRuntime.start()).rejects.toThrow('KA140630: URL is required in outbound mode');
    })
    it('should start a handler runtime in inbound mode', async () => {
        process.env.WORKFLOW_ENGINE_MODE = HandlerRuntimeMode.INBOUND;
        process.env.WEBSOCKET_PORT = '9876';
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        expect(handlerRuntime).toBeDefined();
        await handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));

        // let's open a websocket now
        await new Promise<void>((resolve, reject) => {
            connectedSocket = new WebSocket(`ws://localhost:${process.env.WEBSOCKET_PORT}`);

            connectedSocket.on('open', () => {
                expect(handlerRuntime.isWebSocketConnected()).toBe(true);
                connectedSocket?.close();
                resolve();
            });

            connectedSocket.on('error', (error) => {
                handlerRuntime.stop();
                reject(error);
            });
        });
        handlerRuntime.stop();
    })
    it('should fail to start without a port in inbound mode', () => {
        process.env.WORKFLOW_ENGINE_MODE = HandlerRuntimeMode.INBOUND;
        expect(() => new HandlerRuntime(handlerRuntimeConfig)).toThrow('KA140631: WEBSOCKET_PORT is required in inbound mode');
        delete process.env.WORKFLOW_ENGINE_MODE;
    })
    it('should allow setting and getting the active handler context', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.setActiveHandlerContext('test-request-id', { 'test-token': 'test-token' });
        expect(handlerRuntime.getActiveHandlerContext()).toEqual({ requestId: 'test-request-id', authTokens: { 'test-token': 'test-token' } });
        handlerRuntime.clearActiveHandlerContext();
        expect(handlerRuntime.getActiveHandlerContext()).toBeUndefined();
    })
    it('should throw an error sending a message when not started', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.sendMessage({ messageType: 'test-message' });

        expect(mockLogger.warn).toHaveBeenCalledWith('Attempted to send message while disconnected');
    })
    it('should handle an error on the websocket', async () => {
        const config = { ...handlerRuntimeConfig }
        config.url = 'ws://invalid';
        config.maxAttempts = 1;
        handlerRuntime = new HandlerRuntime(config);
        await expect(handlerRuntime.start()).rejects.toThrow('getaddrinfo ENOTFOUND invalid');
    })
    it('should recover from an unknown message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: 'unknown' }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).toHaveBeenCalledWith('Unknown message type', { 'messageType': 'unknown' });
    })
    it('should handle a protocol error message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.PROTOCOL_ERROR, error: 'bang' }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('Protocol error received', { error: 'bang' });
    })
    it('should handle a protocol error message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.PROTOCOL_ERROR, error: 'bang' }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('Protocol error received', { error: 'bang' });
    })
    it('should handle a transactions result message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT, id: 'test-request-id', submissions: [{ id: 'test', position: 0 }] }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockEngineClient.handleResponse).toHaveBeenCalledWith({ id: 'test-request-id', messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT, submissions: [{ id: 'test', position: 0 }] });
    })
    it('should handle a transactions message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.HANDLE_TRANSACTIONS, id: 'test-request-id', handler: 'test-transaction-handler', transactions: [{ id: 'test-transaction-id', operation: 'test-operation' }] }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    })
    it('should handle an event processor batch message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventProcessor('test-event-processor', mockEventProcessor);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        const request: WSEventProcessorBatchRequest = {
            id: 'test-request-id',
            handler: 'test-event-processor',
            messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
            streamName: 'test-stream-name',
            streamId: 'test-stream-id',
            events: [{ idempotencyKey: 'test-event-id', topic: 'test-topic', data: 'test-data' }]
        };
        connectedSocket?.send(JSON.stringify(request));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockEventProcessor.eventProcessorBatch).toHaveBeenCalledTimes(1);
        expect(mockEventProcessor.eventProcessorBatch).toHaveBeenCalledWith(expect.any(Object), request);
    })
    it('should handle an error for a missing event processor', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        const request: WSEventProcessorBatchRequest = {
            id: 'test-request-id',
            handler: 'test-event-processor',
            messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
            streamName: 'test-stream-name',
            streamId: 'test-stream-id',
            events: [{ idempotencyKey: 'test-event-id', topic: 'test-topic', data: 'test-data' }]
        };
        connectedSocket?.send(JSON.stringify(request));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event processor registered: test-event-processor');
    })
    it('should handle an error when event processor handler is undefined', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        const request: WSEventProcessorBatchRequest = {
            id: 'test-request-id',
            messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
            streamName: 'test-stream-name',
            streamId: 'test-stream-id',
            events: [{ idempotencyKey: 'test-event-id', topic: 'test-topic', data: 'test-data' }]
        };
        connectedSocket?.send(JSON.stringify(request));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event processor registered: undefined');
    })
    it('should handle an error from an event processor batch', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventProcessor('test-event-processor-error', mockEventProcessorError);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        const request: WSEventProcessorBatchRequest = {
            id: 'test-request-id',
            handler: 'test-event-processor-error',
            messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
            streamName: 'test-stream-name',
            streamId: 'test-stream-id',
            events: [{ idempotencyKey: 'test-event-id', topic: 'test-topic', data: 'test-data' }]
        };
        connectedSocket?.send(JSON.stringify(request));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Event processor batch failed', { handler: 'test-event-processor-error', error: expect.any(Error) });
    })
    it('should handle an error for a missing transaction handler', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.HANDLE_TRANSACTIONS, id: 'test-request-id', handler: 'test-transaction-handler', transactions: [{ id: 'test-transaction-id', operation: 'test-operation' }] }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No transaction handler registered: test-transaction-handler');
    })
    it('should handle an error when handler is undefined', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.HANDLE_TRANSACTIONS, id: 'test-request-id', transactions: [{ id: 'test-transaction-id', operation: 'test-operation' }] }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Handler not set in transactions message');
    })
    it('should handle an error from a transaction handler', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandlerError);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({ messageType: WSMessageType.HANDLE_TRANSACTIONS, id: 'test-request-id', handler: 'test-transaction-handler', transactions: [{ id: 'test-transaction-id', operation: 'test-operation' }] }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Handler failed', { handler: 'test-transaction-handler', error: expect.any(Error) });
    })
    it('should handle a non-JSON message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send('not a JSON string');
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringMatching(/Error processing message/),
            expect.objectContaining({ error: expect.any(SyntaxError) })
        );
    })
    it('should reject a binary message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.emit('message', Buffer.from('string'), true)
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.warn).toHaveBeenCalledWith('Received non-string message data, ignoring');
    })
    it('should reconnect', async () => {
        const config = { ...handlerRuntimeConfig };
        config.reconnectDelay = 100;
        handlerRuntime = new HandlerRuntime(config);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(connectedSocket).toBeDefined();
        connectedSocket?.close();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(connectedSocket).toBeDefined();
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.close();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(connectedSocket).toBeDefined();
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        handlerRuntime.stop();
    })
    it('should reconnect at a default delay', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);
        handlerRuntime.start();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(connectedSocket).toBeDefined();
        connectedSocket?.close();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(connectedSocket).not.toBeDefined();
        expect(handlerRuntime.isWebSocketConnected()).toBe(false);
        await new Promise(resolve => setTimeout(resolve, 1000));
        expect(connectedSocket).toBeDefined();
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        handlerRuntime.stop();
    })
    it('should handle an event source config message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.debug).toHaveBeenCalledWith('Event source config', {
            stream: 'test-stream-id',
            name: 'test-stream-name'
        });
    })
    it('should handle an event source poll message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        // First send config to store it
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        await new Promise(resolve => setTimeout(resolve, 50));
        // Then send poll request
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'test-poll-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            authTokens: { 'test-token': 'test-value' }
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockEventSource.eventSourcePoll).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    })
    it('should handle an error for a missing event source on poll', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'test-poll-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source or config: test-event-source/test-stream-id');
    })
    it('should handle an error for a missing config on poll', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'test-poll-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source or config: test-event-source/test-stream-id');
    })
    it('should handle an event source poll message with undefined handler', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        // First send config to store it
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        await new Promise(resolve => setTimeout(resolve, 50));
        // Then send poll request with undefined handler
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'test-poll-id',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source or config: undefined/test-stream-id');
    })
    it('should handle an error from an event source poll', async () => {
        const mockEventSourceError: EventSource = {
            name: () => 'test-event-source-error',
            init: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve()),
            eventSourcePoll: jest.fn(() => Promise.reject(new Error('poll-error'))),
            eventSourceValidateConfig: jest.fn(() => Promise.resolve()),
            eventSourceDelete: jest.fn(() => Promise.resolve()),
        };
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source-error', mockEventSourceError);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        // First send config to store it
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source-error',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        await new Promise(resolve => setTimeout(resolve, 50));
        // Then send poll request
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_POLL,
            id: 'test-poll-id',
            handler: 'test-event-source-error',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Event source poll failed', { handler: 'test-event-source-error', error: expect.any(Error) });
    })
    it('should handle an event source validate config message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'test-validate-id',
            handler: 'test-event-source',
            authTokens: { 'test-token': 'test-value' }
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockEventSource.eventSourceValidateConfig).toHaveBeenCalledTimes(1);
        expect(mockLogger.debug).toHaveBeenCalledWith('Event source validate config', { handler: 'test-event-source' });
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    })
    it('should handle an error for a missing event source on validate config', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'test-validate-id',
            handler: 'test-event-source'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source registered: test-event-source');
    })
    it('should handle an error when handler is undefined in validate config', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'test-validate-id'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source registered: undefined');
    })
    it('should handle an error from an event source validate config', async () => {
        const mockEventSourceError: EventSource = {
            name: () => 'test-event-source-error',
            init: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve()),
            eventSourcePoll: jest.fn(() => Promise.resolve()),
            eventSourceValidateConfig: jest.fn(() => Promise.reject(new Error('validate-error'))),
            eventSourceDelete: jest.fn(() => Promise.resolve()),
        };
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source-error', mockEventSourceError);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG,
            id: 'test-validate-id',
            handler: 'test-event-source-error'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Event source validate config failed', { handler: 'test-event-source-error', error: expect.any(Error) });
    })
    it('should handle an event source delete message', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source', mockEventSource);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        // First send config to store it
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        await new Promise(resolve => setTimeout(resolve, 50));
        // Then send delete request
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'test-delete-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id',
            authTokens: { 'test-token': 'test-value' }
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockEventSource.eventSourceDelete).toHaveBeenCalledTimes(1);
        expect(mockLogger.debug).toHaveBeenCalledWith('Event source delete', {
            handler: 'test-event-source',
            stream: 'test-stream-id'
        });
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    })
    it('should handle an error for a missing event source on delete', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'test-delete-id',
            handler: 'test-event-source',
            streamId: 'test-stream-id'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source registered: test-event-source');
    })
    it('should handle an error when handler is undefined in delete', async () => {
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'test-delete-id',
            streamId: 'test-stream-id'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('No event source registered: undefined');
    })
    it('should handle an error from an event source delete', async () => {
        const mockEventSourceError: EventSource = {
            name: () => 'test-event-source-error',
            init: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve()),
            eventSourcePoll: jest.fn(() => Promise.resolve()),
            eventSourceValidateConfig: jest.fn(() => Promise.resolve()),
            eventSourceDelete: jest.fn(() => Promise.reject(new Error('delete-error'))),
        };
        handlerRuntime = new HandlerRuntime(handlerRuntimeConfig);
        handlerRuntime.registerEventSource('test-event-source-error', mockEventSourceError);
        handlerRuntime.start();
        // Wait a bit for the server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(handlerRuntime.isWebSocketConnected()).toBe(true);
        // First send config to store it
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_CONFIG,
            id: 'test-config-id',
            handler: 'test-event-source-error',
            streamId: 'test-stream-id',
            streamName: 'test-stream-name',
            config: { test: 'config' }
        }));
        await new Promise(resolve => setTimeout(resolve, 50));
        // Then send delete request
        connectedSocket?.send(JSON.stringify({
            messageType: WSMessageType.EVENT_SOURCE_DELETE,
            id: 'test-delete-id',
            handler: 'test-event-source-error',
            streamId: 'test-stream-id'
        }));
        handlerRuntime.stop();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockLogger.error).toHaveBeenCalledWith('Event source delete failed', { handler: 'test-event-source-error', error: expect.any(Error) });
    })

    describe('WebSocket heartbeat', () => {
        afterEach(() => {
            mockLogger.warn.mockClear();
            mockLogger.error.mockClear();
            mockLogger.info.mockClear();
            mockLogger.debug.mockClear();
        });
        it('should setup and cleanup heartbeat timers', async () => {
            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);

            const startPromise = handlerRuntime.start();

            // Wait for connection to establish with timeout
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 100)),
                startPromise
            ]);

            // Wait a bit more for heartbeat setup
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify heartbeat setup was logged
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Setting up WebSocket heartbeat',
                expect.objectContaining({
                    pingInterval: 10,
                    pongTimeout: 5
                })
            );

            // Stop the runtime - this should cleanup heartbeat
            handlerRuntime.stop();

            // Verify cleanup was logged
            expect(mockLogger.debug).toHaveBeenCalledWith('Cleared ping interval');
        });
        it('should clear pong timeout when pong is received', async () => {
            mockShouldRespondToPings = true; // Ensure server responds to pings

            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);

            const startPromise = handlerRuntime.start();

            // Wait for connection to establish
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 100)),
                startPromise
            ]);

            // Wait a bit more for connection
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            // Clear previous logs
            mockLogger.warn.mockClear();

            // Wait for first ping to be sent (which sets up pongTimeout)
            // With pingIntervalMs: 100, we need to wait at least 100ms
            await new Promise(resolve => setTimeout(resolve, 110));

            // Verify ping was sent
            expect(pingReceived).toBe(true);

            // Server should have responded with pong (since mockShouldRespondToPings is true)
            // Wait a bit for the pong to be processed
            await new Promise(resolve => setTimeout(resolve, 10));

            // Now wait for the pongTimeout period (50ms) plus a small buffer
            // If the pong handler worked correctly, the timeout should have been cleared
            // and we should NOT see the "Pong timeout" warning
            await new Promise(resolve => setTimeout(resolve, 60));

            // Verify that the pong timeout warning was NOT called
            // (because the pong event should have cleared the timeout)
            expect(mockLogger.warn).not.toHaveBeenCalledWith('Pong timeout - connection appears dead, reconnecting');

            // Verify connection is still alive
            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            handlerRuntime.stop();
        });
        it('should return early from setupHeartbeat when WebSocket is undefined', () => {
            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            // Access private method using type assertion
            (handlerRuntime as any).setupHeartbeat();
            expect(mockLogger.debug).not.toHaveBeenCalledWith(
                'Setting up WebSocket heartbeat',
                expect.any(Object)
            );
        });
        it('should log when receiving ping from server', async () => {
            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);

            const startPromise = handlerRuntime.start();

            // Wait for connection to establish with timeout
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 100)),
                startPromise
            ]);

            // Wait a bit more for connection
            await new Promise(resolve => setTimeout(resolve, 10));

            // Clear previous debug logs
            mockLogger.debug.mockClear();

            // Send a ping from the server to the client
            if (connectedSocket) {
                connectedSocket.ping();

                // Wait a bit for the ping event to be processed
                await new Promise(resolve => setTimeout(resolve, 10));

                // Verify that receiving ping from server was logged
                expect(mockLogger.debug).toHaveBeenCalledWith('Received WebSocket ping from server');
            }

            handlerRuntime.stop();
        });
        it('should send ping and receive pong to maintain heartbeat', async () => {
            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);

            const startPromise = handlerRuntime.start();

            // Wait for connection to establish with timeout
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 100)),
                startPromise
            ]);

            // Wait a bit more for connection
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            // Wait for first ping to be sent (10ms interval + small buffer)
            await new Promise(resolve => setTimeout(resolve, 15));

            // Verify connection is still alive (pong should have been received)
            // The ws library automatically responds to pings with pong
            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            handlerRuntime.stop();
        });
        it('should terminate connection when pong timeout occurs', async () => {
            // Set flag to prevent pong replies
            mockShouldRespondToPings = false;

            handlerRuntime = new HandlerRuntime(heartbeatConfig);

            await handlerRuntime.start();

            await new Promise(resolve => setTimeout(resolve, 200));

            connectedSocket?.pong();

            expect(pingReceived).toBe(true);
            expect(ignoredPing).toBe(true);

            handlerRuntime.stop();
            connectedSocket?.terminate();

            await new Promise(resolve => setTimeout(resolve, 1000));

            expect(mockLogger.warn).toHaveBeenCalledWith('Pong timeout - connection appears dead, reconnecting');
        });
        it('should handle multiple ping-pong cycles', async () => {
            handlerRuntime = new HandlerRuntime(heartbeatConfig);
            handlerRuntime.registerTransactionHandler('test-transaction-handler', mockTransactionHandler);

            const startPromise = handlerRuntime.start();

            // Wait for connection to establish with timeout
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 100)),
                startPromise
            ]);

            // Wait a bit more for connection
            await new Promise(resolve => setTimeout(resolve, 10));

            // Wait for first ping cycle (10ms)
            await new Promise(resolve => setTimeout(resolve, 15));
            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            // Wait for second ping cycle (another 10ms)
            await new Promise(resolve => setTimeout(resolve, 15));
            expect(handlerRuntime.isWebSocketConnected()).toBe(true);

            handlerRuntime.stop();
        });
    })
})