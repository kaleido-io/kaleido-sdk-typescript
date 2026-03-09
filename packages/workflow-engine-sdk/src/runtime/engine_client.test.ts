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

import { mockLogger } from '../../tests/mock-logger';

import { EngineClient } from './engine_client';
import { EngineClientRuntime } from './engine_client';
import { WSEngineAPISubmitTransactionsResult, WSMessageType } from '../types/core';

describe('EngineClient', () => {
    let mockEngineClientRuntime: EngineClientRuntime;

    beforeEach(() => {
        mockEngineClientRuntime = {
            sendMessage: jest.fn(),
            getActiveHandlerContext: jest.fn(() => ({ requestId: 'test', authTokens: { 'test': 'test' } })),
            isWebSocketConnected: jest.fn(() => true),
            generateId: jest.fn(() => 'test'),
        } as any as EngineClientRuntime;
    });
    it('should create an engine client', () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        expect(engineClient).toBeDefined();
    })
    it('should throw an error if the runtime is not connected', async () => {
        mockEngineClientRuntime.isWebSocketConnected = jest.fn(() => false);
        const engineClient = new EngineClient(mockEngineClientRuntime);
        await expect(engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }])).rejects.toThrow(/KA140627/);

    })
    it('should throw an error if the active handler context is not set', async () => {
        mockEngineClientRuntime.getActiveHandlerContext = jest.fn(() => undefined);
        const engineClient = new EngineClient(mockEngineClientRuntime);
        await expect(engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }])).rejects.toThrow(/KA140616/);

    })
    it('should submit asynchronous transactions', () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }]);
        expect(mockEngineClientRuntime.sendMessage).toHaveBeenCalledTimes(1);
        const message: any = (mockEngineClientRuntime.sendMessage as jest.Mock).mock.calls[0][0];
        expect(message).toBeDefined();
        expect(message.activeRequestId).toBe('test');
        expect(message.authRef).toBe('test');
        expect(message.id).toBeDefined();
        expect(message.messageType).toBe('engineapi_submit_transactions');
        expect(message.transactions).toBeDefined();
        expect(message.transactions).toEqual([{ operation: 'test', workflow: 'test' }]);
    })
    it('should handle an inflight response from the engine', async () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        const resultPromise = engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }]);
        const sentMessage: any = (mockEngineClientRuntime.sendMessage as jest.Mock).mock.calls[0][0];
        const requestId = sentMessage.id;
        expect(requestId).toBeDefined();
        engineClient.handleResponse({
            id: requestId,
            messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT,
            submissions: [{ id: 'test', position: 0 }],
        });
        expect(mockEngineClientRuntime.sendMessage).toHaveBeenCalledTimes(1);
        expect(await resultPromise).toEqual([{ id: 'test', position: 0 }]);
    })
    it('should handle an inflight response with missing submissions from the engine', async () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        const resultPromise = engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }]);
        const sentMessage: any = (mockEngineClientRuntime.sendMessage as jest.Mock).mock.calls[0][0];
        const requestId = sentMessage.id;
        expect(requestId).toBeDefined();
        engineClient.handleResponse({
            id: requestId,
            messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT,
        } as any as WSEngineAPISubmitTransactionsResult);
        expect(mockEngineClientRuntime.sendMessage).toHaveBeenCalledTimes(1);
        expect(await resultPromise).toEqual([]);
    })
    it('should handle an unknown response from the engine', () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        engineClient.handleResponse({
            id: 'test',
            messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT,
            submissions: [{ id: 'test', position: 0 }],
        });
        expect(mockLogger.warn).toHaveBeenCalledWith('Received response for unknown request', { id: 'test' });
    })
    it('should handle an error response from the engine', async () => {
        const engineClient = new EngineClient(mockEngineClientRuntime);
        const resultPromise = engineClient.submitAsyncTransactions('test', [{
            workflow: 'test',
            operation: 'test',
        }]);
        const sentMessage: any = (mockEngineClientRuntime.sendMessage as jest.Mock).mock.calls[0][0];
        engineClient.handleResponse({
            id: sentMessage.id,
            messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT,
            error: 'boom',
        } as any as WSEngineAPISubmitTransactionsResult);
        await expect(resultPromise).rejects.toThrow(/boom/);
    })
})