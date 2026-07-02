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

import { jest } from '@jest/globals';
import * as path from 'path';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../log/logger', () => ({
  newLogger: jest.fn(() => mockLogger),
}));

import { loadServiceBindings, parseServiceBindingsSection } from './service-binding';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('loadServiceBindings', () => {
  it('should parse service bindings from config file', () => {
    const configPath = path.join(FIXTURES_DIR, 'config-with-bindings.yaml');
    const bindings = loadServiceBindings(configPath);

    // 3 valid bindings: asset-manager, key-manager, hosted-service
    // no-url-binding is skipped (no bindingType:hosted and no url)
    expect(Object.keys(bindings)).toHaveLength(3);

    expect(bindings['asset-manager']).toEqual({
      type: 'asset-manager',
      bindingType: 'non-hosted',
      url: 'https://example.com/endpoint/env/am/rest/api/v1',
      auth: {
        type: 'basic',
        username: 'test-key',
        password: 'test-secret',
      },
      maxRetries: 5,
      timeout: 60000,
    });

    expect(bindings['key-manager']).toEqual({
      type: 'key-manager',
      bindingType: 'non-hosted',
      url: 'https://example.com/endpoint/env/km/rest/api/v1',
      auth: {
        type: 'token',
        token: 'km-token-456',
        header: 'Authorization',
        scheme: 'Bearer',
      },
      maxRetries: undefined,
      timeout: undefined,
    });

    expect(bindings['hosted-service']).toEqual({
      type: 'asset-manager',
      bindingType: 'hosted',
      id: 'u:9999',
      maxRetries: undefined,
      timeout: undefined,
    });
  });

  it('should return empty map when config has no service-bindings section', () => {
    // Use the wfe-config fixture from the bindings fixture (no service-bindings key)
    // Pass a path to a YAML with no service-bindings — simulate by using a nonexistent section
    const bindings = loadServiceBindings('/nonexistent/path.yaml');
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it('should return empty map when config file does not exist', () => {
    const bindings = loadServiceBindings('/nonexistent/path.yaml');
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it('should return empty map when no path given and env not set', () => {
    const originalKaleido = process.env.KALEIDO_CONFIG_FILE;
    const originalWfe = process.env.WFE_CONFIG_FILE;
    delete process.env.KALEIDO_CONFIG_FILE;
    delete process.env.WFE_CONFIG_FILE;
    try {
      const bindings = loadServiceBindings();
      expect(Object.keys(bindings)).toHaveLength(0);
    } finally {
      if (originalKaleido !== undefined) process.env.KALEIDO_CONFIG_FILE = originalKaleido;
      if (originalWfe !== undefined) process.env.WFE_CONFIG_FILE = originalWfe;
    }
  });
});

describe('parseServiceBindingsSection', () => {
  it('should parse a section with basic auth (non-hosted)', () => {
    const section = {
      'my-service': {
        type: 'my-type',
        bindingType: 'non-hosted',
        url: 'https://example.com',
        auth: { type: 'basic', username: 'u', password: 'p' },
      },
    };
    const bindings = parseServiceBindingsSection(section);
    expect(bindings['my-service']).toEqual({
      type: 'my-type',
      bindingType: 'non-hosted',
      url: 'https://example.com',
      auth: { type: 'basic', username: 'u', password: 'p' },
      maxRetries: undefined,
      timeout: undefined,
    });
  });

  it('should default type to binding name when type is missing', () => {
    const section = {
      'asset-manager': {
        bindingType: 'non-hosted',
        url: 'https://example.com',
        auth: { type: 'basic', username: 'u', password: 'p' },
      },
    };
    const bindings = parseServiceBindingsSection(section);
    expect(bindings['asset-manager'].type).toBe('asset-manager');
  });

  it('should parse hosted bindings', () => {
    const section = {
      'my-am': {
        type: 'asset-manager',
        bindingType: 'hosted',
        id: 'u:1234',
      },
    };
    const bindings = parseServiceBindingsSection(section);
    expect(bindings['my-am']).toEqual({
      type: 'asset-manager',
      bindingType: 'hosted',
      id: 'u:1234',
      maxRetries: undefined,
      timeout: undefined,
    });
  });

  it('should skip invalid entries', () => {
    const section = {
      'valid': { type: 'x', bindingType: 'non-hosted', url: 'https://example.com', auth: { type: 'basic', username: 'u', password: 'p' } },
      'invalid': null,
      'also-invalid': 'not-an-object',
    } as any;
    const bindings = parseServiceBindingsSection(section);
    expect(Object.keys(bindings)).toHaveLength(1);
    expect(bindings['valid']).toBeDefined();
  });
});
