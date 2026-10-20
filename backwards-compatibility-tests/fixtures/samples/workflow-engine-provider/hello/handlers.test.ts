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

// Mirrors what the SDK stage director passes as the handler's second argument:
// the stage's mapped input, with the stageDirector it synthesizes from the directing fields.
const stageInput = (fields: Record<string, unknown>) => ({
    action: 'hello',
    outputPath: '/output',
    nextStage: 'end',
    failureStage: 'failure',
    ...fields,
    stageDirector: {
        action: 'hello',
        outputPath: '/output',
        nextStage: 'end',
        failureStage: 'failure'
    }
});

const getHandler = () => {
    const handler = actionMap.get('hello');
    expect(handler).toBeDefined();
    if (!handler || !handler.handler) {
        throw new Error('Handler not found');
    }
    return handler.handler;
};

describe('Hello handlers', () => {
    it('should return a greeting when name is provided', async () => {
        const result = await getHandler()({} as WSEvaluateTransaction, stageInput({ name: 'World' }));

        expect(result.result).toBe(EvalResult.COMPLETE);
        expect(result.output).toEqual({
            greeting: 'Hello World!'
        });
    });

    it('should read the name from the stage input, not the operation input in state', async () => {
        const mockRequest: Partial<WSEvaluateTransaction> = {
            state: {
                input: {
                    name: 'Operation'
                }
            }
        };

        const result = await getHandler()(mockRequest as WSEvaluateTransaction, stageInput({ name: 'Stage' }));

        expect(result.result).toBe(EvalResult.COMPLETE);
        expect(result.output).toEqual({
            greeting: 'Hello Stage!'
        });
    });

    it('should return HARD_FAILURE when name is missing from the stage input', async () => {
        const mockRequest: Partial<WSEvaluateTransaction> = {
            state: {
                input: {
                    name: 'Operation'
                }
            }
        };

        const result = await getHandler()(mockRequest as WSEvaluateTransaction, stageInput({}));

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });

    it('should return HARD_FAILURE when the stage input is undefined', async () => {
        const result = await getHandler()({} as WSEvaluateTransaction, undefined as any);

        expect(result.result).toBe(EvalResult.HARD_FAILURE);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Name is required');
    });
});
