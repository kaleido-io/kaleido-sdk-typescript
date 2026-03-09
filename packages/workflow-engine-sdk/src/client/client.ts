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


import { HandlerRuntime, HandlerRuntimeConfig } from '../runtime/handler_runtime';
import { TransactionHandler, EventSource, EventProcessor } from '../interfaces/handlers';

export interface WorkflowEngineClientConfig {
  url?: string;
  providerName: string;
  providerMetadata?: Record<string, string>;
  authToken?: string;
  authHeaderName?: string;
  headers?: Record<string, string>;
  options?: any;
  reconnectDelay?: number;
  maxAttempts?: number;
}

export class WorkflowEngineClient {
  private runtime: HandlerRuntime;

  constructor(config: WorkflowEngineClientConfig) {
    const runtimeConfig: HandlerRuntimeConfig = {
      url: config.url,
      providerName: config.providerName,
      providerMetadata: config.providerMetadata,
      authToken: config.authToken,
      authHeaderName: config.authHeaderName,
      headers: config.headers,
      options: config.options,
      reconnectDelay: config.reconnectDelay,
      maxAttempts: config.maxAttempts,
    };

    this.runtime = new HandlerRuntime(runtimeConfig);
  }

  registerTransactionHandler(name: string, handler: TransactionHandler): void {
    this.runtime.registerTransactionHandler(name, handler);
  }

  registerEventSource(name: string, handler: EventSource): void {
    this.runtime.registerEventSource(name, handler);
  }

  registerEventProcessor(name: string, handler: EventProcessor): void {
    this.runtime.registerEventProcessor(name, handler);
  }

  async connect(): Promise<void> {
    await this.runtime.start();
  }

  disconnect(): void {
    this.runtime.stop();
  }

  close(): void {
    this.disconnect();
  }

  isConnected(): boolean {
    return this.runtime.isWebSocketConnected();
  }
}

