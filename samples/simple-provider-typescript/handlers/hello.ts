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

import {
  BasicStageDirector,
  EvalResult,
  InvocationMode,
  WSEvaluateTransaction,
  type ActionConfig,
  type WithStageDirector,
} from '@kaleido-io/workflow-engine-sdk';

class HelloHandlerInput implements WithStageDirector {
  public stageDirector: BasicStageDirector;

  constructor(data: Record<string, unknown>) {
    this.stageDirector = new BasicStageDirector(
      (data.action as string) || 'hello',
      (data.outputPath as string) || '/output',
      (data.nextStage as string) || 'end',
      (data.failureStage as string) || 'failed',
    );
  }

  getStageDirector(): BasicStageDirector {
    return this.stageDirector;
  }
}

const map: Map<string, ActionConfig<HelloHandlerInput>> = new Map([
  [
    'hello',
    {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction) => {
        const name = transaction.state?.input?.name;
        if (typeof name !== 'string' || name.length === 0) {
          return {
            result: EvalResult.HARD_FAILURE,
            error: new Error('name is required'),
          };
        }

        return {
          result: EvalResult.COMPLETE,
          output: {
            greeting: `Hello ${name}!`,
          },
        };
      },
    },
  ],
]);

export const actionMap = map;
