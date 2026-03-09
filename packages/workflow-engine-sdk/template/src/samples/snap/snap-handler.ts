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

import { BasicStageDirector, EvalResult, InvocationMode, WithStageDirector, WSEvaluateTransaction } from "@kaleido-io/workflow-engine-sdk";

import { newLogger } from "@kaleido-io/workflow-engine-sdk";

const log = newLogger('snap-handler');

class SnapHandlerInput implements WithStageDirector {
    public stageDirector: BasicStageDirector;
    public suit: string;
    public rank: string;

    constructor(input: any) {
        this.stageDirector = new BasicStageDirector(
            input.action || 'set-trap',
            input.outputPath || '/output',
            input.nextStage || 'success',
            input.failureStage || 'fail'
        );
        this.suit = input.suit;
        this.rank = input.rank;
    }

    getStageDirector() {
        return this.stageDirector;
    }
}
const trapsSet = new Map<string, boolean>();

const map = new Map();

// Set trap action
map.set('set-trap', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction: WSEvaluateTransaction, input: SnapHandlerInput) => {
        const cardTopic = `suit.${input.suit}.rank.${input.rank}`;
        return {
            result: EvalResult.COMPLETE,
            triggers: [{ topic: cardTopic }]
        };
    }
});

// Trap set action
map.set('trap-set', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction: WSEvaluateTransaction, input: SnapHandlerInput) => {
        const cardTopic = `suit.${input.suit}.rank.${input.rank}`;
        log.info(`Trap set: ${cardTopic}`);
        trapsSet.set(cardTopic, true);
        return {
            result: EvalResult.WAITING
        };
    }
});

// Trap fired action
map.set('trap-fired', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction: WSEvaluateTransaction, _input: SnapHandlerInput) => {
        const snap = transaction.events![0];
        return {
            result: EvalResult.COMPLETE,
            output: snap.data
        };
    }
});

export const actionMap = map;