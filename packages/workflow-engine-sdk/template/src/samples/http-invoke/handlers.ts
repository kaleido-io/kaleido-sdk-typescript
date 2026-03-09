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


import { BasicStageDirector, DirectedActionConfig, EvalResult, InvocationMode, WithStageDirector } from "@kaleido-io/workflow-engine-sdk";

class HTTPInvokeHandlerInput implements WithStageDirector {
    public stageDirector: BasicStageDirector;
    public action1?: { inputA: string };
    public action2?: { inputB: string };
    public customData?: any;

    constructor(data: any) {
        this.stageDirector = new BasicStageDirector(
            data.action || 'http-invoke',
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

const url = 'https://httpbin.org/get';
const map: Map<string, DirectedActionConfig<HTTPInvokeHandlerInput>> = new Map([
    ["http-invoke", {
        invocationMode: InvocationMode.PARALLEL, handler: async () => {
            const response = await fetch(url, {
                headers: {
                    'X-API-KEY': process.env.API_KEY ?? '',
                },
            });
            const body = await response.json();
            return {
                result: EvalResult.COMPLETE,
                output: {
                    body,
                    status: response.status,
                },
            }
        }
    }],
]);

export const actionMap = map;