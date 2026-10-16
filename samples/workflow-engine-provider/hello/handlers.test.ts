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

import { describe, it, expect } from 'vitest';
import { EvalResult } from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';
import { actionMap } from './handlers.js';

describe('Hello handlers', () => {
    it('should return a greeting when name is provided', async () => {
        const result = await invokeAction(actionMap, 'hello', { name: 'World' });

        expect(result.result).toBe(EvalResult.COMPLETE);
        expect(result.output).toEqual({
            greeting: 'Hello World!'
        });
    });

    it('should emit a greeting event keyed by the transaction', async () => {
        const result = await invokeAction(actionMap, 'hello', { name: 'World' }, { transaction: { idempotencyKey: 'txn-key' } });

        expect(result.events).toEqual([{ idempotencyKey: 'txn-key', topic: 'greeting', data: 'Hello World!' }]);
    });

    it('should read the name from the stage input, not the operation input in state', async () => {
        const result = await invokeAction(actionMap, 'hello', { name: 'Stage' }, { transaction: { state: { input: { name: 'Operation' } } } });

        expect(result.result).toBe(EvalResult.COMPLETE);
        expect(result.output).toEqual({
            greeting: 'Hello Stage!'
        });
    });

    it('should return HARD_FAILURE when name is missing from the stage input', async () => {
        const result = await invokeAction(actionMap, 'hello', {}, { transaction: { state: { input: { name: 'Operation' } } } });

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });
});
