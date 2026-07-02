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

// Cast needed: mock doesn't need to satisfy the full discriminated-union shape
const mockServiceClientOptions = {} as unknown as ServiceClientOptions;

const mockPutStream = jest.fn<(path: string, body: unknown) => Promise<{ id?: string }>>();

jest.mock('./connector-client', () => ({
  ConnectorClient: jest.fn().mockImplementation(() => ({ putStream: mockPutStream })),
}));

jest.mock('@kaleido-io/core-sdk/log', () => ({
  newLogger: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

import { ensureStream } from './ensure-stream';
import { ConnectorClient } from './connector-client';

const mockGetServiceClientOptions = jest.fn<(name: string) => ServiceClientOptions>().mockReturnValue(mockServiceClientOptions);

const ctx = {
  providerName: 'my-provider',
  handlerName: 'my-handler',
  getServiceClientOptions: mockGetServiceClientOptions,
};

describe('ensureStream', () => {
  beforeEach(() => { jest.clearAllMocks(); mockPutStream.mockResolvedValue({ id: 'stream-123' }); });

  it('resolves service client options using the connector binding name', async () => {
    await ensureStream(ctx, {
      connectorBindingName: 'btc-connector',
      factory: 'transactionEvents',
      name: 'btc-mainnet',
      eventSourceConfig: { fromBlock: '0' },
    });

    expect(mockGetServiceClientOptions).toHaveBeenCalledWith('btc-connector');
    expect(ConnectorClient).toHaveBeenCalledWith(mockServiceClientOptions);
  });

  it('sends PUT to the correct stream factory path', async () => {
    await ensureStream(ctx, {
      connectorBindingName: 'evm-connector',
      factory: 'transactionEvents',
      name: 'eth-mainnet',
      eventSourceConfig: {},
    });

    expect(mockPutStream).toHaveBeenCalledWith(
      '/api/v1/stream-factories/transactionEvents/api/streams/eth-mainnet',
      expect.any(Object),
    );
  });

  it('builds the correct stream body with provider, handler, and eventSourceConfig', async () => {
    const eventSourceConfig = { fromBlock: '100', batchSize: 50 };

    await ensureStream(ctx, {
      connectorBindingName: 'btc-connector',
      factory: 'transactionEvents',
      name: 'btc-mainnet',
      eventSourceConfig,
      description: 'BTC mainnet stream',
    });

    expect(mockPutStream).toHaveBeenCalledWith(
      expect.any(String),
      {
        description: 'BTC mainnet stream',
        eventProcessor: {
          type: 'handler',
          handler: { provider: 'my-provider', name: 'my-handler' },
        },
        eventSource: {
          type: 'handler',
          handler: { config: eventSourceConfig },
        },
      },
    );
  });

  it('passes undefined description when omitted', async () => {
    await ensureStream(ctx, {
      connectorBindingName: 'btc-connector',
      factory: 'transactionEvents',
      name: 'btc-mainnet',
      eventSourceConfig: {},
    });

    expect(mockPutStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: undefined }),
    );
  });
});
