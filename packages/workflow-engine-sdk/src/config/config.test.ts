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


import { describe, it, expect } from '@jest/globals';

import { mockLogger } from '../../tests/mock-logger';

import { AuthConfig, AuthType, ConfigLoader, WorkflowEngineConfig } from './config';

const tokenAuthConfig: WorkflowEngineConfig = {
    workflowEngine: {
        url: 'http://localhost:5503',
        auth: {
            type: AuthType.TOKEN,
            token: 'dev-token-123',
            header: 'X-Kld-Authz',
            scheme: 'Bearer'
        },
        maxRetries: 10,
        retryDelay: '2s'
    }
}

const tokenAuthConfigWithDefaultHeaderAndScheme: WorkflowEngineConfig = {
    workflowEngine: {
        url: 'http://localhost:5503',
        auth: {
            type: AuthType.TOKEN,
            token: 'dev-token-123'
        }
    }
}

const basicAuthConfig: WorkflowEngineConfig = {
    workflowEngine: {
        url: 'http://localhost:5503',
        auth: {
            type: AuthType.BASIC,
            username: 'admin',
            password: 'secret123'
        }
    }
}

const basicAuthConfigHttps: WorkflowEngineConfig = {
    workflowEngine: {
        url: 'https://localhost:5503',
        auth: {
            type: AuthType.BASIC,
            username: 'admin',
            password: 'secret123'
        }
    }
}

const unknownAuthConfig: WorkflowEngineConfig = {
    workflowEngine: {
        url: 'http://localhost:5503',
        auth: {
            type: 'unknown' as AuthType,
        } as any as AuthConfig
    }
}

describe('ConfigLoader', () => {
    it('should create client config with token auth', async () => {
        const clientConfig = ConfigLoader.createClientConfig(tokenAuthConfig, 'my-service');
        expect(clientConfig).toBeDefined();
        expect(clientConfig.providerName).toBe('my-service');
        expect(clientConfig.url).toBe('ws://localhost:5503/ws');
        expect(clientConfig.options?.headers).toBeDefined();
        expect(clientConfig.options?.headers['X-Kld-Authz']).toBe('Bearer dev-token-123');
        expect(clientConfig.maxAttempts).toBe(10);
        expect(clientConfig.reconnectDelay).toBe(2000);
    })
    it('should create client config with token auth with default header and scheme', async () => {
        const clientConfig = ConfigLoader.createClientConfig(tokenAuthConfigWithDefaultHeaderAndScheme, 'my-service');
        expect(clientConfig).toBeDefined();
        expect(clientConfig.url).toBe('ws://localhost:5503/ws');
        expect(clientConfig.providerName).toBe('my-service');
        expect(clientConfig.options?.headers).toBeDefined();
        expect(clientConfig.options?.headers['Authorization']).toBe('dev-token-123');
    })
    it('should create client config with basic auth', async () => {
        const clientConfig = ConfigLoader.createClientConfig(basicAuthConfig, 'my-service');
        expect(clientConfig).toBeDefined();
        expect(clientConfig.url).toBe('ws://localhost:5503/ws');
        expect(clientConfig.providerName).toBe('my-service');
        expect(clientConfig.options?.headers).toBeDefined();
        expect(clientConfig.options?.headers['Authorization']).toBe('Basic YWRtaW46c2VjcmV0MTIz');
    })
    it('should create client config with basic auth https', async () => {
        const clientConfig = ConfigLoader.createClientConfig(basicAuthConfigHttps, 'my-service');
        expect(clientConfig).toBeDefined();
        expect(clientConfig.url).toBe('wss://localhost:5503/ws');
        expect(clientConfig.providerName).toBe('my-service');
        expect(clientConfig.options?.headers).toBeDefined();
        expect(clientConfig.options?.headers['Authorization']).toBe('Basic YWRtaW46c2VjcmV0MTIz');
    })
    it('should throw an error if the auth type is unknown', async () => {
        expect(() => ConfigLoader.createClientConfig(unknownAuthConfig, 'my-service')).toThrow('Unknown auth type: unknown');
    })
    it('should log a summary', async () => {
        ConfigLoader.logConfigSummary(basicAuthConfig);
        expect(mockLogger.info).toHaveBeenCalledWith('Configuration loaded:');
        expect(mockLogger.info).toHaveBeenCalledWith('  Workflow Engine: http://localhost:5503');
        expect(mockLogger.info).toHaveBeenCalledWith('  Auth Type: basic');
        expect(mockLogger.info).toHaveBeenCalledWith('  Username: admin');
        mockLogger.info.mockClear();
        ConfigLoader.logConfigSummary(tokenAuthConfig);
        expect(mockLogger.info).toHaveBeenCalledWith('Configuration loaded:');
        expect(mockLogger.info).toHaveBeenCalledWith('  Workflow Engine: http://localhost:5503');
        expect(mockLogger.info).toHaveBeenCalledWith('  Auth Type: token');
        expect(mockLogger.info).toHaveBeenCalledWith('  Auth Header: X-Kld-Authz');
        expect(mockLogger.info).toHaveBeenCalledWith('  Auth Scheme: Bearer');
        expect(mockLogger.info).toHaveBeenCalledWith('  Max Retries: 10');
        expect(mockLogger.info).toHaveBeenCalledWith('  Retry Delay: 2s');
        mockLogger.info.mockClear();
        ConfigLoader.logConfigSummary(tokenAuthConfigWithDefaultHeaderAndScheme);
        expect(mockLogger.info).toHaveBeenCalledWith('  Auth Header: Authorization');
    })
})  