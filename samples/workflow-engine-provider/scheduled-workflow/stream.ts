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

import provider from '../provider.js';

/** Runs the hello workflow every five minutes. */
export const stream = {
  name: 'scheduled-hello',
  description: 'Start a hello-flow transaction each time the scheduled source emits an event',
  started: true,
  eventSource: {
    type: 'handler',
    handler: {
      name: 'scheduled-source',
      provider: provider.name,
      config: { intervalMs: 300_000 },
    },
  },
  eventProcessor: {
    type: 'transaction_dispatch',
    transactionDispatch: {
      transactionTemplate: {
        workflow: 'hello-flow',
        operation: 'hello',
        jsonata: '{ "input": { "name": "scheduled run at " & data.scheduledAt } }',
      },
    },
  },
};
