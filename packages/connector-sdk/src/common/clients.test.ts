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

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ServiceClientOptions } from '@kaleido-io/core-sdk/http';
import type { EnsureStreamOptions } from './ensure-stream';

const mockEnsureStream = jest.fn<(ctx: unknown, opts: EnsureStreamOptions) => Promise<void>>().mockResolvedValue(undefined);
const mockLoadServiceBindings = jest.fn();

jest.mock('../common/ensure-stream', () => ({ ensureStream: mockEnsureStream }));
jest.mock('@kaleido-io/core-sdk', () => ({ loadServiceBindings: mockLoadServiceBindings }));

import { BTCConnectorClient } from '../btc/client';
import { EVMConnectorClient } from '../evm/client';
import { CantonConnectorClient } from '../canton/client';

const mockGetServiceClientOptions = jest.fn<(name: string) => ServiceClientOptions>().mockReturnValue({} as unknown as ServiceClientOptions);

const mockCtx = {
  providerName: 'my-provider',
  handlerName: 'my-handler',
  getServiceClientOptions: mockGetServiceClientOptions,
};

describe('BTCConnectorClient', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('fromConfigFile', () => {
    it('succeeds when bindings map is empty (no config file)', () => {
      mockLoadServiceBindings.mockReturnValue({});
      expect(() => BTCConnectorClient.fromConfigFile('btc-connector')).not.toThrow();
    });

    it('succeeds when the named binding exists', () => {
      mockLoadServiceBindings.mockReturnValue({ 'btc-connector': {} });
      expect(() => BTCConnectorClient.fromConfigFile('btc-connector')).not.toThrow();
    });

    it('throws when bindings are present but the named binding is missing', () => {
      mockLoadServiceBindings.mockReturnValue({ 'other-service': {} });
      expect(() => BTCConnectorClient.fromConfigFile('btc-connector')).toThrow(
        "Service binding 'btc-connector' not found",
      );
    });

    it('uses btc-connector as the default binding name', () => {
      mockLoadServiceBindings.mockReturnValue({});
      const client = BTCConnectorClient.fromConfigFile();
      expect(client).toBeInstanceOf(BTCConnectorClient);
    });
  });

  describe('ensureStream', () => {
    it('delegates to common ensureStream with the correct binding name and options', async () => {
      const client = new BTCConnectorClient('my-btc');
      const config = { fromBlock: '0', batchSize: 10 };
      await client.ensureStream(mockCtx, {
        factory: 'transactionEvents',
        name: 'btc-mainnet',
        eventSourceConfig: config,
        description: 'desc',
      });

      expect(mockEnsureStream).toHaveBeenCalledWith(mockCtx, {
        connectorBindingName: 'my-btc',
        factory: 'transactionEvents',
        name: 'btc-mainnet',
        eventSourceConfig: config,
        description: 'desc',
      });
    });
  });
});

describe('EVMConnectorClient', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('fromConfigFile', () => {
    it('succeeds when bindings map is empty', () => {
      mockLoadServiceBindings.mockReturnValue({});
      expect(() => EVMConnectorClient.fromConfigFile('evm-connector')).not.toThrow();
    });

    it('throws when bindings are present but the named binding is missing', () => {
      mockLoadServiceBindings.mockReturnValue({ 'other-service': {} });
      expect(() => EVMConnectorClient.fromConfigFile('evm-connector')).toThrow(
        "Service binding 'evm-connector' not found",
      );
    });
  });

  describe('ensureStream', () => {
    it('delegates to common ensureStream with the correct binding name and options', async () => {
      const client = new EVMConnectorClient('my-evm');
      const config = { fromBlock: '0', methods: [{ address: '0xabc', abi: [] }] };
      await client.ensureStream(mockCtx, {
        factory: 'transactionEvents',
        name: 'eth-mainnet',
        eventSourceConfig: config,
      });

      expect(mockEnsureStream).toHaveBeenCalledWith(mockCtx, {
        connectorBindingName: 'my-evm',
        factory: 'transactionEvents',
        name: 'eth-mainnet',
        eventSourceConfig: config,
        description: undefined,
      });
    });
  });
});

describe('CantonConnectorClient', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('fromConfigFile', () => {
    it('succeeds when the named binding exists', () => {
      mockLoadServiceBindings.mockReturnValue({ 'canton-connector': {} });
      expect(() => CantonConnectorClient.fromConfigFile('canton-connector')).not.toThrow();
    });

    it('throws when bindings are present but the named binding is missing', () => {
      mockLoadServiceBindings.mockReturnValue({ 'other-service': {} });
      expect(() => CantonConnectorClient.fromConfigFile('canton-connector')).toThrow(
        "Service binding 'canton-connector' not found",
      );
    });
  });

  describe('ensureStream', () => {
    it('delegates to common ensureStream with the correct binding name and options', async () => {
      const client = new CantonConnectorClient('my-canton');
      const config = { fromOffset: 0, userId: 'Alice::abc123' };
      await client.ensureStream(mockCtx, {
        factory: 'contractEvents',
        name: 'canton-stream',
        eventSourceConfig: config,
        description: 'Canton test',
      });

      expect(mockEnsureStream).toHaveBeenCalledWith(mockCtx, {
        connectorBindingName: 'my-canton',
        factory: 'contractEvents',
        name: 'canton-stream',
        eventSourceConfig: config,
        description: 'Canton test',
      });
    });
  });
});
