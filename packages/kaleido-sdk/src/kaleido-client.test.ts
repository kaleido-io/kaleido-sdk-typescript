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

import { describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import {
  resolveServiceBindingFromMap,
  type ServiceBindingsMap,
} from '@kaleido-io/core';
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import {
  EVMConnectorClient,
  BTCConnectorClient,
  CantonConnectorClient,
} from '@kaleido-io/connector-sdk';
import { KaleidoClient } from './kaleido-client.js';

const nonHostedBindings: ServiceBindingsMap = {
  'asset-manager': {
    type: 'asset-manager',
    bindingType: 'non-hosted',
    url: 'https://am.example/api/v1',
    auth: { type: 'token', token: 'secret' },
  },
  'asset-manager-2': {
    type: 'asset-manager',
    bindingType: 'non-hosted',
    url: 'https://am2.example/api/v1',
    auth: { type: 'token', token: 'secret2' },
  },
};

const hostedBindings: ServiceBindingsMap = {
  'hosted-am': {
    type: 'asset-manager',
    bindingType: 'hosted',
    id: 'svc-123',
  },
};

describe('resolveServiceBindingFromMap (core helper)', () => {
  it('maps a non-hosted binding to direct HTTP options', () => {
    const opts = resolveServiceBindingFromMap(nonHostedBindings['asset-manager']);
    expect(opts).toMatchObject({
      transport: 'http',
      url: 'https://am.example/api/v1',
      auth: { type: 'token', token: 'secret' },
    });
  });

  it('maps a hosted binding to ws-proxy options when an adapter is supplied', () => {
    const fakeProxy = { request: async () => ({ status: 200 }) };
    const opts = resolveServiceBindingFromMap(hostedBindings['hosted-am'], fakeProxy);
    expect(opts).toMatchObject({
      transport: 'ws-proxy',
      serviceType: 'asset-manager',
      id: 'svc-123',
    });
  });

  it('throws for a hosted binding with no adapter', () => {
    expect(() => resolveServiceBindingFromMap(hostedBindings['hosted-am'])).toThrow(
      /hosted binding/i,
    );
  });
});

describe('KaleidoClient — non-hosted only (no workflow-engine)', () => {
  it('builds an AssetManagerClient with no primary WFE connection', () => {
    const client = new KaleidoClient({ serviceBindings: nonHostedBindings });
    const am = client.assetManagerClient('asset-manager');
    expect(am).toBeInstanceOf(AssetManagerClient);
  });

  it('memoizes per binding name', () => {
    const client = new KaleidoClient({ serviceBindings: nonHostedBindings });
    expect(client.assetManagerClient('asset-manager')).toBe(
      client.assetManagerClient('asset-manager'),
    );
    expect(client.assetManagerClient('asset-manager')).not.toBe(
      client.assetManagerClient('asset-manager-2'),
    );
  });

  it('throws when workflowEngineClient() is called without a primary connection', () => {
    const client = new KaleidoClient({ serviceBindings: nonHostedBindings });
    expect(() => client.workflowEngineClient()).toThrow(/no primary workflow-engine/i);
  });

  it('throws a clear error for a hosted binding with no primary connection', () => {
    const client = new KaleidoClient({ serviceBindings: hostedBindings });
    expect(() => client.assetManagerClient('hosted-am')).toThrow(
      /no primary workflow-engine/i,
    );
  });

  it('throws a clear error for an unknown binding', () => {
    const client = new KaleidoClient({ serviceBindings: nonHostedBindings });
    expect(() => client.assetManagerClient('does-not-exist')).toThrow(
      /not found/i,
    );
  });
});

describe('KaleidoClient — provider mode (with workflow-engine)', () => {
  it('returns a memoized primary WorkflowEngineClient', () => {
    const client = new KaleidoClient({
      workflowEngine: { providerName: 'test-provider' },
      serviceBindings: nonHostedBindings,
    });
    const wfe = client.workflowEngineClient();
    expect(wfe).toBeInstanceOf(WorkflowEngineClient);
    expect(client.workflowEngineClient()).toBe(wfe);
  });
});

describe('KaleidoClient — connector accessors', () => {
  const client = new KaleidoClient({ serviceBindings: {} });

  it('returns connector clients with default and custom binding names', () => {
    expect(client.evmConnectorClient()).toBeInstanceOf(EVMConnectorClient);
    expect(client.btcConnectorClient('btc-2')).toBeInstanceOf(BTCConnectorClient);
    expect(client.cantonConnectorClient()).toBeInstanceOf(CantonConnectorClient);
  });
});

describe('KaleidoClient.fromConfigFile', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
  });

  function writeConfig(contents: string): string {
    const file = join(fs.mkdtempSync(join(os.tmpdir(), 'ksdk-cfg-')), 'config.yaml');
    fs.writeFileSync(file, contents, 'utf8');
    tmpFiles.push(file);
    return file;
  }

  it('loads both the primary connection and bindings', () => {
    const file = writeConfig(`
workflow-engine:
  providerName: test-provider
  url: http://localhost:8080
  auth:
    type: basic
    username: u
    password: p
service-bindings:
  asset-manager:
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example/api/v1
    auth:
      type: token
      token: secret
`);
    const client = KaleidoClient.fromConfigFile(file);
    expect(client.workflowEngineClient()).toBeInstanceOf(WorkflowEngineClient);
    expect(client.assetManagerClient('asset-manager')).toBeInstanceOf(AssetManagerClient);
    expect(Object.keys(client.getServiceBindings())).toContain('asset-manager');
  });

  it('supports a service-bindings-only config (no workflow-engine section)', () => {
    const file = writeConfig(`
service-bindings:
  asset-manager:
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example/api/v1
    auth:
      type: token
      token: secret
`);
    const client = KaleidoClient.fromConfigFile(file);
    expect(client.assetManagerClient('asset-manager')).toBeInstanceOf(AssetManagerClient);
    expect(() => client.workflowEngineClient()).toThrow(/no primary workflow-engine/i);
  });
});
