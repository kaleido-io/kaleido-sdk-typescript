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


import { WorkflowEngineClientConfig } from '../client/client';
import { newLogger } from '../log/logger';
import { SDKErrors, newError } from '../i18n/errors';

const log = newLogger('config');

/**
 * Authentication type enum
 */
export enum AuthType {
  BASIC = 'basic',
  TOKEN = 'token'
}

/**
 * Basic authentication using username and password
 */
export interface BasicAuth {
  type: AuthType.BASIC;
  username: string;
  password: string;
}

/**
 * Token-based authentication
 */
export interface TokenAuth {
  type: AuthType.TOKEN;
  token: string;
  header?: string;  // Header name (default: Authorization)
  scheme?: string;  // Auth scheme: Bearer, Basic, or empty for raw token
}

/**
 * Authentication configuration (discriminated union)
 */
export type AuthConfig = BasicAuth | TokenAuth;

/**
 * Standard configuration structure for workflow engine connectors
 * 
 * This configuration should be provided by the application using the SDK.
 * The SDK does not load configuration from files - it receives it from the caller.
 */
export interface WorkflowEngineConfig {
  workflowEngine: {
    url: string;
    auth: AuthConfig;
    maxRetries?: number;
    retryDelay?: string;
  };
}

/**
 * Configuration utility for transforming WorkflowEngineConfig into client config
 * 
 * The SDK receives configuration objects - it does not load from files.
 * Applications using this SDK should load configuration themselves and pass it in.
 */
export class ConfigLoader {

  /**
   * Create WorkflowEngineClientConfig from WorkflowEngineConfig
   */
  static createClientConfig(
    config: WorkflowEngineConfig,
    providerName: string
  ): WorkflowEngineClientConfig {
    const auth = config.workflowEngine.auth;
    let headerName: string;
    let authValue: string;
    
    // Use discriminated union to handle different auth types
    switch (auth.type) {
      case AuthType.BASIC: {
        headerName = 'Authorization';
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        authValue = `Basic ${credentials}`;
        break;
      }
        
      case AuthType.TOKEN: {
        headerName = auth.header || 'Authorization';
        const scheme = auth.scheme || '';
        authValue = scheme ? `${scheme} ${auth.token}` : auth.token;
        break;
      }
        
      default: {
        // TypeScript ensures this is unreachable if all cases are handled
        const _exhaustive: never = auth;
        throw newError(SDKErrors.MsgSDKConfigUnknownAuthType, (_exhaustive as any).type);
      }
    }
    
    // Convert HTTP(S) URL to WebSocket URL with /ws path
    let wsUrl = config.workflowEngine.url;
    if (wsUrl.startsWith('http://')) {
      wsUrl = 'ws://' + wsUrl.substring(7);
    } else if (wsUrl.startsWith('https://')) {
      wsUrl = 'wss://' + wsUrl.substring(8);
    }
    // Add /ws path if not already present
    if (!wsUrl.endsWith('/ws')) {
      wsUrl = wsUrl.replace(/\/$/, '') + '/ws';
    }
    
    return {
      url: wsUrl,
      providerName,
      options: {
        headers: {
          [headerName]: authValue
        }
      },
      maxAttempts: config.workflowEngine.maxRetries, // undefined = infinite retries
      reconnectDelay: config.workflowEngine.retryDelay ? parseInt(config.workflowEngine.retryDelay.replace('s', '')) * 1000 : 2000
    };
  }

  /**
   * Log configuration summary (without sensitive data)
   */
  static logConfigSummary(config: WorkflowEngineConfig): void {
    log.info('Configuration loaded:');
    log.info(`  Workflow Engine: ${config.workflowEngine.url}`);
    
    const auth = config.workflowEngine.auth;
    switch (auth.type) {
      case AuthType.BASIC:
        log.info(`  Auth Type: ${AuthType.BASIC}`);
        log.info(`  Username: ${auth.username}`);
        break;
      case AuthType.TOKEN:
        log.info(`  Auth Type: ${AuthType.TOKEN}`);
        log.info(`  Auth Header: ${auth.header || 'Authorization'}`);
        if (auth.scheme) {
          log.info(`  Auth Scheme: ${auth.scheme}`);
        }
        break;
      }
      
      if (config.workflowEngine.maxRetries) {
        log.info(`  Max Retries: ${config.workflowEngine.maxRetries}`);
      }
    
      if (config.workflowEngine.retryDelay) {
        log.info(`  Retry Delay: ${config.workflowEngine.retryDelay}`);
      }
  }
}

