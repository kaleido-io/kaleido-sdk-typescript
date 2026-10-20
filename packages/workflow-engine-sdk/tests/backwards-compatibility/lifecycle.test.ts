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

// Records registration messages and the setup lifecycle of a real
// WorkflowEngineClient, and compares them with the expected messages recorded on
// 1.0.1.

import { mockLogger } from '../mock-logger';
import { describe, it } from '@jest/globals';
import { createServiceTransport, ServiceClientOptions } from '@kaleido-io/core-sdk/http';

import {
  EvalResult,
  InvocationMode,
  WorkflowEngineClient,
  WorkflowEngineClientConfig,
  createTransactionHandler,
  createEventSource,
} from '../../src/index';
import { FakeEngine } from './fixtures/fake-engine';
import { expectToMatchExpectedMessages } from './helpers/expected-data-helper';

void mockLogger;

const hostedBindings: WorkflowEngineClientConfig['serviceBindings'] = {
  'asset-manager': { bindingType: 'hosted', serviceType: 'AssetManagerService', id: 's-am' },
};
const nonHostedBindings: WorkflowEngineClientConfig['serviceBindings'] = {
  'asset-manager': { bindingType: 'non-hosted', url: 'http://asset-manager.invalid', auth: { type: 'token', token: 't' } },
};

const handler = () => createTransactionHandler('captured', new Map([
  ['go', { invocationMode: InvocationMode.PARALLEL, handler: async () => ({ result: EvalResult.COMPLETE }) }],
]));
const source = () => createEventSource('source', async () => ({ checkpointOut: {}, events: [] }));

// A builder client with a setup hook on a transaction handler and on an event
// processor. The hooks record what they saw; the transaction handler's hook
// also calls a hosted service, the way the list-pools sample captures options.
function builderClient(engine: FakeEngine, serviceBindings: WorkflowEngineClientConfig['serviceBindings'], runs: Record<string, unknown>[]) {
  let captured: ServiceClientOptions | undefined;
  const client = new WorkflowEngineClient<{ table: string }>({ providerName: 'compat-provider', url: engine.url, maxAttempts: 1, serviceBindings }, { table: 'balances' })
    .transactionHandler('captured', {
      setup: async (ctx) => {
        captured = ctx.getServiceClientOptions('asset-manager');
        const call = captured.transport === 'ws-proxy'
          ? await createServiceTransport(captured).get('/api/v1/setup-check')
          : null;
        runs.push({ hook: 'captured', handlerName: ctx.handlerName, providerName: ctx.providerName, transport: captured.transport, authRef: (captured as { authRef?: string }).authRef ?? null, call });
      },
      handler: handler(),
    })
    .eventProcessor('indexer', {
      setup: async (ctx) => {
        runs.push({ hook: 'indexer', handlerName: ctx.handlerName, config: ctx.config, aborted: ctx.signal.aborted });
        if ((ctx.getServiceClientOptions('asset-manager') as { authRef?: string }).authRef === 'auth-bad') {
          throw new Error('setup refused');
        }
      },
      processBatch: async () => {},
    })
    .eventSource(source());
  return client;
}

describe('backwards compatibility: registration and setup lifecycle', () => {
  it('matches the recording with hosted bindings, where setup waits for a trigger', async () => {
    const engine = new FakeEngine();
    await engine.start();
    const runs: Record<string, unknown>[] = [];
    const client = builderClient(engine, hostedBindings, runs);
    try {
      await client.start();
      const registrations = await engine.waitForRegistration(3);
      const runsAtBoot = [...runs];
      const triggerOk = await engine.triggerSetup('setup-1', 'auth-good');
      const runsAfterOk = runs.splice(0);
      const triggerBad = await engine.triggerSetup('setup-2', 'auth-bad');
      expectToMatchExpectedMessages('lifecycle-hosted', {
        registrations,
        runsAtBoot,
        triggerOk,
        runsAfterOk,
        triggerBad,
        runsAfterBad: runs,
        serviceProxyRequests: engine.ofType('service-proxy-request'),
      });
    } finally {
      client.stop();
      await engine.close();
    }
  });

  it('matches the recording with non-hosted bindings, where setup runs at boot', async () => {
    const engine = new FakeEngine();
    await engine.start();
    const runs: Record<string, unknown>[] = [];
    const client = builderClient(engine, nonHostedBindings, runs);
    try {
      await client.start();
      const registrations = await engine.waitForRegistration(3);
      const runsAtBoot = runs.splice(0);
      const trigger = await engine.triggerSetup('setup-3', 'auth-later');
      expectToMatchExpectedMessages('lifecycle-non-hosted', { registrations, runsAtBoot, trigger, runsAfterTrigger: runs });
    } finally {
      client.stop();
      await engine.close();
    }
  });

  it('matches the recording for the low-level registration path', async () => {
    const engine = new FakeEngine();
    await engine.start();
    const client = new WorkflowEngineClient({ providerName: 'compat-provider', providerMetadata: { version: '1.2.3' }, url: engine.url, maxAttempts: 1, serviceBindings: hostedBindings });
    client.registerTransactionHandler('captured', handler());
    client.registerEventSource('source', source());
    try {
      await client.connect();
      const registrations = await engine.waitForRegistration(2);
      const trigger = await engine.triggerSetup('setup-4', 'auth-any');
      expectToMatchExpectedMessages('lifecycle-low-level', {
        registrations,
        trigger,
        hostedOptions: { ...client.getServiceClientOptions('asset-manager', 'auth-x'), wsProxy: '<adapter>' },
      });
    } finally {
      client.stop();
      await engine.close();
    }
  });
});
