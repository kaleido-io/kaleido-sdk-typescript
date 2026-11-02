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
import { greeting } from '../lib/greeting.js';

// The stage's mapped input: the result of the stage's inputMap in the workflow.
interface HelloInput {
  name?: string;
}

export const helloHandler = defineTransactionHandler('hello', {
  hello: async (input: HelloInput, ctx) => {
    if (!input.name) {
      // A throw fails the stage: the transaction moves to the stage's failureStage.
      throw new Error('name is required');
    }
    const message = greeting(input.name);
    return complete({ greeting: message }, {
      events: [{ idempotencyKey: ctx.transaction.idempotencyKey, topic: 'greeting', data: message }],
    });
  },
});
