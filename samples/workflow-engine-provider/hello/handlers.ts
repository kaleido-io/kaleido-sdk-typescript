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

import { complete, defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

// The stage's mapped input: the result of the stage's inputMap in flow.ts.
// This is not transaction.state.input, which is the operation's input.
interface HelloInput {
    name?: string;
}

export const helloHandler = defineTransactionHandler({
    hello: async (input: HelloInput, ctx) => {
        if (input.name === undefined) {
            // A throw fails the stage: the transaction moves to the stage's failureStage.
            throw new Error('Name is required');
        }
        const greeting = `Hello ${input.name}!`;
        return complete({ greeting }, {
            events: [{ idempotencyKey: ctx.transaction.idempotencyKey, topic: 'greeting', data: greeting }],
        });
    },
});
