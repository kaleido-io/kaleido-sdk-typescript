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

// The ways custom providers written against 1.0.1 build and start a client.
// These are only type-checked, never run.

import type { ServiceClientOptions } from '@kaleido-io/core-sdk/http';
import {
  ProviderBase,
  TransactionHandlerRegistration,
  WorkflowEngineClient,
  WorkflowEngineClientConfig,
  createTransactionHandler,
  createWorkflowEngineClient,
  handlerSetFor,
} from '@kaleido-io/workflow-engine-sdk';

import { DelegatingTransactionHandler, RawTransactionHandler, actionMap, greeter } from './transaction-handlers.js';
import { RawEventProcessor, RawEventSource, inline, store, storeLiteral, ticks } from './events.js';

interface AppConfig { table: string }

// The low-level path: a handler set and createWorkflowEngineClient.
export async function lowLevel(): Promise<WorkflowEngineClient> {
  const client = await createWorkflowEngineClient(
    handlerSetFor(greeter, new RawTransactionHandler(), ticks, new RawEventSource(), new RawEventProcessor()),
    './config.yaml',
  );
  const options: ServiceClientOptions = client.getServiceClientOptions('asset-manager', 'auth-ref');
  void [options, client.getServiceBindings(), client.getServiceBinding('asset-manager'), client.isConnected];
  client.close();
  return client;
}

// Registering handlers on a client built by hand.
export async function manual(): Promise<void> {
  const config: WorkflowEngineClientConfig = { providerName: 'p', url: 'ws://localhost:5000/ws', serviceBindings: {} };
  const client = new WorkflowEngineClient<AppConfig>(config, { table: 't' });
  client.registerTransactionHandler('greeter', greeter);
  client.registerTransactionHandler('delegating', new DelegatingTransactionHandler());
  client.registerEventSource('ticks', ticks);
  client.registerEventProcessor('raw-processor', new RawEventProcessor());
  await client.connect();
  client.disconnect();
}

// The builder path, including the setup-capture pattern the list-pools sample uses.
export async function builder(): Promise<void> {
  let captured: ServiceClientOptions | undefined;
  const registration: TransactionHandlerRegistration = {
    setup: async (ctx) => { captured = ctx.getServiceClientOptions('asset-manager'); },
    handler: createTransactionHandler('captured', actionMap),
  };

  const app = WorkflowEngineClient.fromConfigFile<AppConfig>('./config.yaml')
    .transactionHandler('greeter', { handler: greeter })
    .transactionHandler('captured', registration)
    .eventProcessor('store', store)
    .eventProcessor('store-literal', storeLiteral)
    .eventSource(ticks)
    .eventSource(inline);

  await app.setup('auth-ref');
  await app.start();
  app.stop();
  void captured;
}

// ProviderBase, for providers that build their own connection details.
export async function providerBase(): Promise<WorkflowEngineClient> {
  const base = new ProviderBase<AppConfig>({
    platform: { url: 'https://platform.example', auth: { type: 'basic', username: 'u', password: 'p' } },
    providerName: 'p',
    environmentNameOrId: 'e1',
    workflowEngineNameOrId: 'wfe',
    config: { table: 't' },
  });
  return base.createClient();
}
