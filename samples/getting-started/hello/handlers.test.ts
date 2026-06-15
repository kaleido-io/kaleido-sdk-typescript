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
import { EvalResult, WSEvaluateTransaction } from '@kaleido-io/workflow-engine-sdk';
import { actionMap } from './handlers';

describe('Hello handlers', () => {
    it('should return a greeting when name is provided', async () => {
        const handler = actionMap.get('hello');
        expect(handler).toBeDefined();

        if (!handler || !handler.handler) {
            throw new Error('Handler not found');
        }

        const mockRequest: Partial<WSEvaluateTransaction> = {
            state: {
                input: {
                    name: 'World'
                }
            }
        };

        const mockInput = {
            stageDirector: {
                action: 'hello',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed'
            },
            getStageDirector: () => mockInput.stageDirector,
            name: () => 'hello'
        };

        const result = await handler.handler(mockRequest as WSEvaluateTransaction, mockInput as any);

        expect(result.result).toBe(EvalResult.COMPLETE);
        expect(result.output).toEqual({
            greeting: 'Hello World!'
        });
    });

    it('should return HARD_FAILURE when name is missing', async () => {
        const handler = actionMap.get('hello');
        expect(handler).toBeDefined();

        if (!handler || !handler.handler) {
            throw new Error('Handler not found');
        }

        const mockRequest: Partial<WSEvaluateTransaction> = {
            state: {
                input: {}
            }
        };

        const mockInput = {
            stageDirector: {
                action: 'hello',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed'
            },
            getStageDirector: () => mockInput.stageDirector,
            name: () => 'hello'
        };

        const result = await handler.handler(mockRequest as WSEvaluateTransaction, mockInput as any);

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });

    it('should return HARD_FAILURE when state.input is undefined', async () => {
        const handler = actionMap.get('hello');
        expect(handler).toBeDefined();

        if (!handler || !handler.handler) {
            throw new Error('Handler not found');
        }

        const mockRequest: Partial<WSEvaluateTransaction> = {
            state: {}
        };

        const mockInput = {
            stageDirector: {
                action: 'hello',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed'
            },
            getStageDirector: () => mockInput.stageDirector,
            name: () => 'hello'
        };

        const result = await handler.handler(mockRequest as WSEvaluateTransaction, mockInput as any);

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });

    it('should return HARD_FAILURE when state is undefined', async () => {
        const handler = actionMap.get('hello');
        expect(handler).toBeDefined();

        if (!handler || !handler.handler) {
            throw new Error('Handler not found');
        }

        const mockRequest: Partial<WSEvaluateTransaction> = {};

        const mockInput = {
            stageDirector: {
                action: 'hello',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed'
            },
            getStageDirector: () => mockInput.stageDirector,
            name: () => 'hello'
        };

        const result = await handler.handler(mockRequest as WSEvaluateTransaction, mockInput as any);

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });
});
