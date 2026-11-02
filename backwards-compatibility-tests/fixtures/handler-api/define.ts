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

// Handlers written with the handler API, without a name and with one. Both forms
// must keep compiling, with the same input and context types.

import {
  complete,
  defineEventSource,
  defineProcessor,
  defineTransactionHandler,
  type EventProcessorEvent,
  WorkflowEngineClient,
} from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';

interface Transfer {
  from: string;
  amount: number;
}

export const unnamedHandler = defineTransactionHandler({
  pay: async (input: { amount: number }) => complete({ paid: input.amount }),
  refund: (input: { id: string }, ctx) => ({ id: input.id, workflow: ctx.transaction.workflowId }),
});

export const namedHandler = defineTransactionHandler('payments', {
  pay: async (input: { amount: number }) => complete({ paid: input.amount }),
  refund: (input: { id: string }, ctx) => ({ id: input.id, workflow: ctx.transaction.workflowId }),
});

export const unnamedProcessor = defineProcessor(async (events: EventProcessorEvent<Transfer>[], ctx) => {
  void ctx.config;
  for (const event of events) void event.data.amount;
});

export const namedProcessor = defineProcessor('transfers', async (events: EventProcessorEvent<Transfer>[], ctx) => {
  void ctx.config;
  for (const event of events) void event.data.amount;
});

export const feed = defineEventSource<{ seen: number }, unknown, Transfer>('transfer-feed', {
  poll: async ({ checkpoint }) => ({ checkpoint: { seen: (checkpoint?.seen ?? 0) + 1 } }),
});

export async function wire(url: string): Promise<void> {
  const client = new WorkflowEngineClient({ providerName: 'p', url })
    .transactionHandler('unnamed', unnamedHandler)
    .transactionHandler('payments', namedHandler)
    .eventProcessor('unnamed-processor', unnamedProcessor)
    .eventProcessor('transfers', namedProcessor)
    .eventSource(feed);
  void client;
  await invokeAction(unnamedHandler, 'pay', { amount: 1 });
  await invokeAction(namedHandler, 'refund', { id: 'r1' });
}
