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


import { BasicStageDirector, DirectedActionConfig, EvalResult, InvocationMode, WithStageDirector, WSEvaluateTransaction } from "@kaleido-io/workflow-engine-sdk";

class MyHandlerInput implements WithStageDirector {
    public stageDirector: BasicStageDirector;
    public action1?: { inputA: string };
    public action2?: { inputB: string };
    public customData?: any;

    constructor(data: any) {
        this.stageDirector = new BasicStageDirector(
            data.action || 'echo',
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
        return 'echo';
    }
}

const map: Map<string, DirectedActionConfig<MyHandlerInput>> = new Map([
    ["echo", {
        invocationMode: InvocationMode.PARALLEL, handler: async (transaction: WSEvaluateTransaction) => {
            if (transaction.state?.input?.data === undefined || transaction.state?.input?.data?.message === undefined) {
                return {
                    result: EvalResult.HARD_FAILURE,
                    error: new Error('Message is required')
                }
            } else {
                return {
                    result: EvalResult.COMPLETE,
                    output: {
                        message: `Event received with message: ${transaction.state.input.data.message}`,
                    }
                }
            }
        }
    }],
]);

export const actionMap = map;