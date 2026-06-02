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

import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import {
  BasicStageDirector,
  DirectedActionConfig,
  EvalResult,
  InvocationMode,
  WithStageDirector,
} from '@kaleido-io/workflow-engine-sdk';

class ListPoolsInput implements WithStageDirector {
  public stageDirector: BasicStageDirector;

  constructor(data: any) {
    this.stageDirector = new BasicStageDirector(
      data.action || 'list-pools',
      data.outputPath || '/output',
      data.nextStage || 'end',
      data.failureStage || 'failed',
    );
  }

  getStageDirector(): BasicStageDirector {
    return this.stageDirector;
  }

  name(): string {
    return 'list-pools';
  }
}

export function createActionMap(
  getAmClient: (authRef?: string) => AssetManagerClient,
): Map<string, DirectedActionConfig<ListPoolsInput>> {
  return new Map([
    [
      'list-pools',
      {
        invocationMode: InvocationMode.PARALLEL,
        handler: async (transaction) => {
          console.log('[list-pools] authRef:', transaction.authRef ?? '(undefined)');
          const result = await getAmClient(transaction.authRef).getPools();
          return {
            result: EvalResult.COMPLETE,
            output: { pools: result?.items ?? [] },
          };
        },
      },
    ],
  ]);
}
