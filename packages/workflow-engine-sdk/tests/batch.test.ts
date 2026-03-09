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
import './mock-logger';

import {
    BasicStageDirector,
    DirectedActionConfig,
    InvocationMode,
    EvalResult,
    WithStageDirector,
    DirectedTransactionBatchIn
} from '../src/index';
import { newLogger } from '../src/log/logger';
import { FlowStageTypes } from '../src/types/flows';

const logger = newLogger('BatchTest');

class BatchTestInput implements WithStageDirector {
    public stageDirector: BasicStageDirector;
    value: number;
    totalValue: number;

    constructor(input: any) {
        this.stageDirector = new BasicStageDirector(
            input.action || 'batch-test',
            input.outputPath || '/output',
            input.nextStage || FlowStageTypes.SUCCESS,
            input.failureStage || FlowStageTypes.FAILURE
        );
        this.value = input.value;
        this.totalValue = input.totalValue;
    }

    getStageDirector(): BasicStageDirector {
        return this.stageDirector;
    }
}

// Simple batch handler for testing
export class BatchTestHandler {
    private actionMap: Map<string, DirectedActionConfig<BatchTestInput>> = new Map();

    constructor() {
        this.setupActionMap();
    }

    private setupActionMap() {
        this.actionMap.set('batch-test', {
            invocationMode: InvocationMode.BATCH,
            batchHandler: this.batchProcess.bind(this)
        });
    }

    private async batchProcess(
        transactions: DirectedTransactionBatchIn<BatchTestInput>[]
    ): Promise<{ result: EvalResult; output?: any; error?: Error }[]> {
        logger.info(`[BatchTest] Processing batch of ${transactions.length} transactions`);

        return transactions.map((req, index) => {
            try {
                const input = req.value;
                logger.info(`[BatchTest] Processing transaction ${index + 1}:`, {
                    transactionId: req.transaction.transactionId,
                    value: input.value,
                    totalValue: input.totalValue
                });

                // Validate input
                if (!input.value || !input.totalValue) {
                    return {
                        result: EvalResult.FIXABLE_ERROR,
                        error: new Error('Missing value or totalValue')
                    };
                }

                // Calculate percentage
                const percentage = (input.value / input.totalValue) * 100;

                const result = {
                    percentage: percentage,
                    result: `The percentage is ${percentage.toFixed(2)}%`,
                    batchIndex: index,
                    batchSize: transactions.length,
                    transactionId: req.transaction.transactionId
                };

                logger.info(`[BatchTest] Success for transaction ${req.transaction.transactionId}: ${percentage.toFixed(2)}%`);

                return {
                    result: EvalResult.COMPLETE,
                    output: result,
                    events: [
                        {
                            idempotencyKey: `key-${index}`,
                            topic: `test-topic-${index}`,
                            data: { index }
                        }
                    ]
                };
            } catch (error) {
                logger.error(`[BatchTest] Error for transaction ${req.transaction.transactionId}:`, error);
                return {
                    result: EvalResult.HARD_FAILURE,
                    error: error instanceof Error ? error : new Error(String(error))
                };
            }
        });
    }

    getActionMap(): Map<string, DirectedActionConfig<BatchTestInput>> {
        return this.actionMap;
    }

    static parseInput(input: any): BatchTestInput {
        return new BatchTestInput(input);
    }
}

describe('Batch Processing Test', () => {
    it('should process batch transactions correctly', async () => {
        const handler = new BatchTestHandler();
        const actionMap = handler.getActionMap();

        // Test the batch handler directly
        const batchAction = actionMap.get('batch-test');
        expect(batchAction).toBeDefined();
        expect(batchAction?.batchHandler).toBeDefined();

        if (!batchAction?.batchHandler) {
            throw new Error('Batch handler not found');
        }

        // Create test transactions
        const testInputs = [
            { value: 25, totalValue: 100 },
            { value: 75, totalValue: 100 },
            { value: 10, totalValue: 50 }
        ];

        const mockRequests: DirectedTransactionBatchIn<BatchTestInput>[] = testInputs.map((input, index) => ({
            transaction: {
                transactionId: `test-${index}`,
                workflowId: 'test-flow',
                handler: 'test-handler',
                stage: 'batch-test',
                sequence: 'test-seq',
                input: input
            },
            value: BatchTestHandler.parseInput({
                action: 'batch-test',
                ...input
            })
        }));

        // Process the batch
        const results = await batchAction.batchHandler(mockRequests);

        // Verify results
        expect(results).toHaveLength(3);

        results.forEach((result, index) => {
            expect(result.result).toBe(EvalResult.COMPLETE);
            expect(result.output).toBeDefined();
            expect(result.output.percentage).toBe(testInputs[index].value / testInputs[index].totalValue * 100);
            expect(result.output.batchIndex).toBe(index);
            expect(result.output.batchSize).toBe(3);
            expect(result.output.transactionId).toBe(`test-${index}`);
            expect(result.events).toHaveLength(1);
            expect(result.events?.[0].idempotencyKey).toBe(`key-${index}`);
            expect(result.events?.[0].topic).toBe(`test-topic-${index}`);
            expect(result.events?.[0].data).toEqual({ index });
        });

        logger.info('Batch processing test completed successfully');
    });

    it('should handle errors in batch processing', async () => {
        const handler = new BatchTestHandler();
        const actionMap = handler.getActionMap();
        const batchAction = actionMap.get('batch-test');

        if (!batchAction?.batchHandler) {
            throw new Error('Batch handler not found');
        }

        // Create test transactions with invalid input
        const mockRequests: DirectedTransactionBatchIn<BatchTestInput>[] = [
            {
                transaction: {
                    transactionId: 'test-error',
                    workflowId: 'test-flow',
                    handler: 'test-handler',
                    stage: 'batch-test',
                    sequence: 'test-seq',
                    input: { value: 50 } // Missing totalValue
                },
                value: BatchTestHandler.parseInput({
                    action: 'batch-test',
                    value: 50
                    // Missing totalValue
                })
            }
        ];

        // Process the batch
        const results = await batchAction.batchHandler(mockRequests);

        // Verify error handling
        expect(results).toHaveLength(1);
        expect(results[0].result).toBe(EvalResult.FIXABLE_ERROR);
        expect(results[0].error).toBeDefined();
        expect(results[0].error?.message).toContain('Missing value or totalValue');
    });
}); 