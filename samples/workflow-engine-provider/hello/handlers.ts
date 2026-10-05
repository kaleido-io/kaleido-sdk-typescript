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


import { ActionConfig, EvalResult, InvocationMode, WithStageDirector, WSEvaluateTransaction } from '@kaleido-io/workflow-engine-sdk';

// The stage's mapped input: the result of the stage's inputMap in flow.ts.
// This is not transaction.state.input, which is the operation's input.
interface HelloInput extends WithStageDirector {
    name?: string;
}

const map: Map<string, ActionConfig<HelloInput>> = new Map([
    ['hello', {
        invocationMode: InvocationMode.PARALLEL, handler: async (transaction: WSEvaluateTransaction, input: HelloInput) => {
            if (input?.name === undefined) {
                return {
                    result: EvalResult.HARD_FAILURE,
                    error: new Error('Name is required')
                }
            } else {
                return {
                    result: EvalResult.COMPLETE,
                    output: {
                        greeting: `Hello ${input.name}!`,
                    },
                    events: [
                        {
                            idempotencyKey: transaction.idempotencyKey,
                            topic: 'greeting',
                            data: `Hello ${input.name}!`
                        }
                    ]
                }
            }
        }
    }],
]);

export const actionMap = map;
