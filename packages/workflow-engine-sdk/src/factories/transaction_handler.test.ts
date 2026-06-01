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


import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../helpers/stage_director', () => ({
    evalDirected: jest.fn(() => Promise.resolve()),
}));

import { evalDirected } from '../helpers/stage_director';
import { EngineClient, EngineClientRuntime } from '../runtime/engine_client';
import { WSHandleTransactions, WSHandleTransactionsResult, WSMessageType } from '../types/core';
import { createDirectedTransactionHandler } from './transaction_handler';

describe('createDirectedTransactionHandler', () => {

    it('should create a transaction handler', () => {
        const transactionHandler = createDirectedTransactionHandler('test-transaction-handler', {});
        expect(transactionHandler).toBeDefined();
        expect(transactionHandler.name()).toBe('test-transaction-handler');
    })
    it('should create a transaction handler with init and close functions', async () => {
        const initFn = jest.fn(() => Promise.resolve());
        const closeFn = jest.fn();
        const engineClientRuntime = {
            sendMessage: jest.fn(),
            isWebSocketConnected: jest.fn(() => true),
            generateId: jest.fn(() => 'test'),
        } as any as EngineClientRuntime;
        const engineClient = new EngineClient(engineClientRuntime);
        const transactionHandler = createDirectedTransactionHandler('test-transaction-handler', {})
            .withInitFn(initFn)
            .withCloseFn(closeFn);
        await transactionHandler.init(engineClient);
        expect(initFn).toHaveBeenCalledTimes(1);
        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions: [],
            handler: 'test-transaction-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };

        await transactionHandler.transactionHandlerBatch({} as any, reply, batch);
        expect(evalDirected).toHaveBeenCalledTimes(1);
        transactionHandler.close();
        expect(closeFn).toHaveBeenCalledTimes(1);
    })
})