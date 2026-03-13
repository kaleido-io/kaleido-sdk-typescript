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


import { describe, it, expect } from '@jest/globals';

//quietens the console during tests
import '../../tests/mock-logger';

import { BasicStageDirector, evalDirected, StageDirectorHelper } from './stage_director';
import { EvalResult, InvocationMode, WithStageDirector, WSHandleTransactions, WSHandleTransactionsResult, WSEvaluateTransaction, WSMessageType, PatchOpType } from '../types/core';
import { DirectedActionConfig } from '../interfaces/handlers';

class MyHandlerInput implements WithStageDirector {
    public stageDirector: BasicStageDirector;
    public action1?: { inputA: string };
    public action2?: { inputB: string };
    public customData?: any;

    constructor(data: any) {
        this.stageDirector = new BasicStageDirector(
            data.action || 'hello',
            data.outputPath || '/output',
            data.nextStage || 'end',
            data.failureStage || 'failed'
        );
        this.customData = data.customData;
    }

    getStageDirector(): BasicStageDirector {
        return this.stageDirector;
    }

    name(): string {
        return 'hello';
    }
}

const actionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
    ['hello', {
        invocationMode: InvocationMode.PARALLEL, handler: async (transaction: WSEvaluateTransaction) => {
            if (transaction.state?.input?.name === undefined) {
                return {
                    result: EvalResult.HARD_FAILURE,
                    error: new Error('Name is required')
                }
            } else {
                return {
                    result: EvalResult.COMPLETE,
                    output: {
                        greeting: `Hello ${transaction.state.input.name}!`,
                    },
                    events: [
                        {
                            idempotencyKey: transaction.idempotencyKey,
                            topic: 'greeting',
                            data: `Hello ${transaction.state.input.name}!`
                        }
                    ]
                }
            }
        }
    }],
]);

describe('BasicStageDirector', () => {

    it('should create a basic stage director', () => {
        const stageDirector = new BasicStageDirector('test-action', 'test-output-path', 'test-next-stage', 'test-failure-stage');
        expect(stageDirector).toBeDefined();
        expect(stageDirector.getStageDirector().action).toBe('test-action');
        expect(stageDirector.getStageDirector().outputPath).toBe('test-output-path');
        expect(stageDirector.getStageDirector().nextStage).toBe('test-next-stage');
        expect(stageDirector.getStageDirector().failureStage).toBe('test-failure-stage');
    })
    it('should handle a batch of transactions', async () => {
        const transactions: WSEvaluateTransaction[] = Array.from({ length: 5 }, (_, i) => ({
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: {
                input: {
                    name: `Tester ${i}`,
                },
            },
            input: {
                action: 'hello',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }));
        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, actionMap);
        Array.from({ length: 5 }, (_, i) => {
            expect(reply.results[i]).toBeDefined();
            expect(reply.results[i].events).toBeDefined();
            expect(reply.results[i].events?.length).toBe(1);
            expect(reply.results[i].events?.[0]?.data).toBe(`Hello Tester ${i}!`);
        })
    })

    it('should handle transactions with plain object input (without getStageDirector)', async () => {
        const plainActionMap: Map<string, DirectedActionConfig<any>> = new Map([
            ['plain-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.COMPLETE,
                        output: { processed: true }
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'plain-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            }
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected(reply, batch, plainActionMap);
        expect(reply.results[0]).toBeDefined();
        expect(reply.results[0].stage).toBe('end');
        expect(reply.results[0].stateUpdates).toBeDefined();
        expect(reply.results[0].stateUpdates?.[0]?.path).toBe('/output');
    })

    it('should handle invalid action', async () => {
        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'invalid-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, actionMap);
        expect(reply.results[0].error).toContain("Invalid action 'invalid-action'");
    })

    it('should handle null input', async () => {
        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: null as any,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, actionMap);
        expect(reply.results[0].error).toBeDefined();
        expect(reply.results[0].error).toContain('Input parsing error');
    })

    it('should handle missing action field in plain object', async () => {
        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            }
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected(reply, batch, actionMap);
        expect(reply.results[0].error).toBeDefined();
        expect(reply.results[0].error).toContain('action');
    })

    it('should handle BATCH invocation mode', async () => {
        const batchActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['batch-action', {
                invocationMode: InvocationMode.BATCH,
                batchHandler: async (batchIn) => {
                    return batchIn.map((req, i) => ({
                        result: EvalResult.COMPLETE,
                        output: { processed: i, batch: true }
                    }));
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = Array.from({ length: 3 }, (_, i) => ({
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: `test-transaction-id-${i}`,
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'batch-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }));

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, batchActionMap);
        expect(reply.results).toHaveLength(3);
        reply.results.forEach((result, i) => {
            expect(result.stage).toBe('end');
            expect(result.stateUpdates).toBeDefined();
            expect(result.stateUpdates?.[0]?.value).toEqual({ processed: i, batch: true });
        });
    })

    it('should handle missing batch handler configuration', async () => {
        const noBatchHandlerActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['no-batch-handler-action', {
                invocationMode: InvocationMode.BATCH,
                // batchHandler is intentionally undefined
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = Array.from({ length: 2 }, (_, i) => ({
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: `test-transaction-id-${i}`,
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'no-batch-handler-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }));

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await expect(evalDirected<MyHandlerInput>(reply, batch, noBatchHandlerActionMap)).rejects.toThrow(/KA140622/);
        // All transactions should have errors since batchHandler is missing
        // expect(reply.results).toHaveLength(2);
        // reply.results.forEach((result) => {
        //     expect(result.error).toBeDefined();
        //     expect(result.error).toContain('KA140622');
        // });
    })

    it('should handle batch handler result count mismatch', async () => {
        const mismatchBatchActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['mismatch-batch-action', {
                invocationMode: InvocationMode.BATCH,
                batchHandler: async (batchIn) => {
                    // Intentionally return fewer results than transactions to trigger line 373
                    // batchIn has 3 transactions, but we only return 2 results
                    return batchIn.slice(0, 2).map((req, i) => ({
                        result: EvalResult.COMPLETE,
                        output: { processed: i, batch: true }
                    }));
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = Array.from({ length: 3 }, (_, i) => ({
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: `test-transaction-id-${i}`,
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'mismatch-batch-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }));

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, mismatchBatchActionMap);
        // All transactions should have errors since batch handler returned wrong count
        expect(reply.results).toHaveLength(3);
        reply.results.forEach((result) => {
            expect(result.error).toBeDefined();
            expect(result.error).toContain('KA140623');
        });
    })

    it('should handle handler execution errors', async () => {
        const errorActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['error-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    throw new Error('Handler execution failed');
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'error-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, errorActionMap);
        expect(reply.results[0].error).toBe('Handler execution failed');
    })

    it('should handle missing handler configuration', async () => {
        const noHandlerActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['no-handler-action', {
                invocationMode: InvocationMode.PARALLEL,
                // handler is intentionally undefined to trigger line 327
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'no-handler-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, noHandlerActionMap);
        expect(reply.results[0].error).toBeDefined();
        expect(reply.results[0].error).toContain('KA140621');
    })

    it('should handle HARD_FAILURE result', async () => {
        const failureActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['failure-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.HARD_FAILURE,
                        error: new Error('Hard failure occurred')
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'failure-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, failureActionMap);
        expect(reply.results[0].stage).toBe('failed');
        expect(reply.results[0].stateUpdates).toBeDefined();
        expect(reply.results[0].stateUpdates?.some(update => update.path === '/error')).toBe(true);
    })

    it('should handle WAITING result', async () => {
        const waitingActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['waiting-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.WAITING
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'waiting-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, waitingActionMap);
        expect(reply.results[0].stage).toBeUndefined();
    })

    it('should handle FIXABLE_ERROR result', async () => {
        const fixableErrorActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['fixable-error-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.FIXABLE_ERROR,
                        error: new Error('Fixable error occurred')
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'fixable-error-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, fixableErrorActionMap);
        expect(reply.results[0].error).toBe('Fixable error occurred');
    })

    it('should handle TRANSIENT_ERROR result', async () => {
        const transientErrorActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['transient-error-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.TRANSIENT_ERROR,
                        error: new Error('Transient error occurred')
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'transient-error-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, transientErrorActionMap);
        expect(reply.results[0].error).toBe('Transient error occurred');
    })

    it('should handle custom stage', async () => {
        const customStageActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['custom-stage-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.COMPLETE,
                        output: { custom: true },
                        customStage: 'custom-next-stage'
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'custom-stage-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, customStageActionMap);
        expect(reply.results[0].stage).toBe('custom-next-stage');
    })

    it('should handle triggers', async () => {
        const triggerActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['trigger-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.COMPLETE,
                        output: { triggered: true },
                        triggers: [
                            { topic: 'trigger-topic-1', ephemeral: false },
                            { topic: 'trigger-topic-2', ephemeral: true }
                        ]
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'trigger-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, triggerActionMap);
        expect(reply.results[0].triggers).toBeDefined();
        expect(reply.results[0].triggers?.length).toBe(2);
        expect(reply.results[0].triggers?.[0]?.topic).toBe('trigger-topic-1');
        expect(reply.results[0].triggers?.[1]?.ephemeral).toBe(true);
    })

    it('should handle extra state updates', async () => {
        const extraUpdatesActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['extra-updates-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.COMPLETE,
                        output: { main: true },
                        extraUpdates: [
                            { op: PatchOpType.ADD, path: '/extra', value: 'extra-value' }
                        ]
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'extra-updates-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, extraUpdatesActionMap);
        expect(reply.results[0].stateUpdates).toBeDefined();
        expect(reply.results[0].stateUpdates?.length).toBe(2);
        expect(reply.results[0].stateUpdates?.some(update => update.path === '/output')).toBe(true);
        expect(reply.results[0].stateUpdates?.some(update => update.path === '/extra')).toBe(true);
    })

    it('should handle extra state updates even with no given output', async () => {
        const extraUpdatesActionMap: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
            ['extra-updates-action', {
                invocationMode: InvocationMode.PARALLEL,
                handler: async (_transaction: WSEvaluateTransaction) => {
                    return {
                        result: EvalResult.COMPLETE,
                        extraUpdates: [
                            { op: PatchOpType.ADD, path: '/extra', value: 'extra-value' }
                        ]
                    };
                }
            }],
        ]);

        const transactions: WSEvaluateTransaction[] = [{
            handler: 'test-handler',
            sequence: 'test-seq',
            transactionId: 'test-transaction-id',
            workflowId: 'test-flow',
            stage: 'batch-test',
            state: { input: {} },
            input: {
                action: 'extra-updates-action',
                outputPath: '/output',
                nextStage: 'end',
                failureStage: 'failed',
            } as any as MyHandlerInput,
        }];

        const reply: WSHandleTransactionsResult = {
            results: [],
            messageType: WSMessageType.EVALUATE,
            id: 'test-id',
        };
        const batch: WSHandleTransactions = {
            transactions,
            handler: 'test-handler',
            messageType: WSMessageType.EVALUATE_RESULT,
            id: 'test-id',
        };
        await evalDirected<MyHandlerInput>(reply, batch, extraUpdatesActionMap);
        expect(reply.results[0].stateUpdates).toBeDefined();
        expect(reply.results[0].stateUpdates?.length).toBe(1);
        expect(reply.results[0].stateUpdates?.some(update => update.path === '/extra')).toBe(true);
    })
})

describe('StageDirectorHelper', () => {
    const mockRequest: WSEvaluateTransaction = {
        handler: 'test-handler',
        sequence: 'test-seq',
        transactionId: 'test-transaction-id',
        workflowId: 'test-flow',
        stage: 'test-stage',
        state: { input: {} }
    };

    const mockStageDirector = new BasicStageDirector('test-action', '/output', 'next-stage', 'failure-stage');

    it('should map COMPLETE result with output', () => {
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            { data: 'test' }
        );
        expect(result.stage).toBe('next-stage');
        expect(result.stateUpdates).toBeDefined();
        expect(result.stateUpdates?.[0]?.path).toBe('/output');
        expect(result.stateUpdates?.[0]?.value).toEqual({ data: 'test' });
    })

    it('should map COMPLETE result without nextStage', () => {
        const stageDirector = new BasicStageDirector('test-action', '/output', '', 'failure-stage');
        const result = StageDirectorHelper.mapOutput(
            stageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            { data: 'test' }
        );
        expect(result.error).toBeDefined();
    })

    it('should map HARD_FAILURE result', () => {
        const error = new Error('Hard failure');
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.HARD_FAILURE,
            undefined,
            error
        );
        expect(result.stage).toBe('failure-stage');
        expect(result.stateUpdates).toBeDefined();
        expect(result.stateUpdates?.some(update => update.path === '/error')).toBe(true);
        expect(result.stateUpdates?.some(update => update.value === error.message)).toBe(true);
    })

    it('should map HARD_FAILURE result without failureStage', () => {
        const stageDirector = new BasicStageDirector('test-action', '/output', 'next-stage', '');
        const error = new Error('Hard failure');
        const result = StageDirectorHelper.mapOutput(
            stageDirector,
            mockRequest,
            EvalResult.HARD_FAILURE,
            undefined,
            error
        );
        expect(result.error).toBeDefined();
    })

    it('should map HARD_FAILURE result without failureStage or error', () => {
        const stageDirector = new BasicStageDirector('test-action', '/output', 'next-stage', '');
        const result = StageDirectorHelper.mapOutput(
            stageDirector,
            mockRequest,
            EvalResult.HARD_FAILURE,
            undefined,
            undefined
        );
        expect(result.error).toMatch(/KA140606/);
    })

    it('should map HARD_FAILURE with custom stage', () => {
        const error = new Error('Hard failure');
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.HARD_FAILURE,
            undefined,
            error,
            undefined,
            undefined,
            'custom-failure-stage'
        );
        expect(result.stage).toBe('custom-failure-stage');
    })

    it('should map WAITING result', () => {
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.WAITING
        );
        expect(result.stage).toBeUndefined();
    })

    it('should map FIXABLE_ERROR result', () => {
        const error = new Error('Fixable error');
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.FIXABLE_ERROR,
            undefined,
            error
        );
        expect(result.error).toBe('Fixable error');
    })

    it('should map TRANSIENT_ERROR result', () => {
        const error = new Error('Transient error');
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.TRANSIENT_ERROR,
            undefined,
            error
        );
        expect(result.error).toBe('Transient error');
    })

    it('should handle output without outputPath', () => {
        const stageDirector = new BasicStageDirector('test-action', '', 'next-stage', 'failure-stage');
        const result = StageDirectorHelper.mapOutput(
            stageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            { data: 'test' }
        );
        expect(result.error).toBeDefined();
    })

    it('should handle triggers', () => {
        const triggers = [
            { topic: 'topic1', ephemeral: false },
            { topic: 'topic2', ephemeral: true }
        ];
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            { data: 'test' },
            undefined,
            triggers
        );
        expect(result.triggers).toBeDefined();
        expect(result.triggers?.length).toBe(2);
        expect(result.triggers?.[0]?.topic).toBe('topic1');
        expect(result.triggers?.[1]?.ephemeral).toBe(true);
    })

    it('should handle events', () => {
        const events = [
            { idempotencyKey: 'key1', topic: 'topic1', data: 'data1' },
            { idempotencyKey: 'key2', topic: 'topic2', data: 'data2' }
        ];
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            { data: 'test' },
            undefined,
            undefined,
            undefined,
            undefined,
            events
        );
        expect(result.events).toBeDefined();
        expect(result.events?.length).toBe(2);
    })

    it('should handle null output', () => {
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            null
        );
        expect(result.stage).toBe('next-stage');
        expect(result.stateUpdates).toBeUndefined();
    })

    it('should handle undefined output', () => {
        const result = StageDirectorHelper.mapOutput(
            mockStageDirector,
            mockRequest,
            EvalResult.COMPLETE,
            undefined
        );
        expect(result.stage).toBe('next-stage');
        expect(result.stateUpdates).toBeUndefined();
    })
})