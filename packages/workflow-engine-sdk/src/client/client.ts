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

import {
  HandlerRuntime,
  HandlerRuntimeConfig,
} from "../runtime/handler_runtime";
import {
  TransactionHandler,
  EventSource,
  EventProcessor,
} from "../interfaces/handlers";
import { ServiceBindingsMap, ServiceBindingConfig } from "../service/types";
import { ServiceClientOptions } from "@kaleido-io/core/http";
import { WSProxyAdapter } from "../service/ws_proxy_adapter";

/**
 * TLS options for the WebSocket server (inbound mode).
 * Cert and key are required when TLS is enabled.
 */
export interface ServerTlsConfig {
  enabled: boolean;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
}

/**
 * Server config for inbound mode: app creates a WebSocket server and the workflow engine connects to it.
 */
export interface ServerConfig {
  address: string;
  /** Defaults to 6000 when omitted (inbound WebSocket server). */
  port?: number;
  tls?: ServerTlsConfig;
}

export interface WorkflowEngineClientConfig {
  /** Outbound: URL of the workflow engine WebSocket. When set, the client connects to the engine. */
  url?: string;
  /** Inbound: create a WebSocket server on this address/port. When set, the engine connects to the app. */
  server?: ServerConfig;
  providerName: string;
  providerMetadata?: Record<string, string>;
  authToken?: string;
  authHeaderName?: string;
  headers?: Record<string, string>;
  options?: any;
  reconnectDelay?: number;
  maxAttempts?: number;
  /** Service bindings for platform service access (asset-manager, key-manager, etc.) */
  serviceBindings?: ServiceBindingsMap;
}

export class WorkflowEngineClient {
  private runtime: HandlerRuntime;
  private bindings: ServiceBindingsMap;

  constructor(config: WorkflowEngineClientConfig) {
    const runtimeConfig: HandlerRuntimeConfig = {
      url: config.url,
      server: config.server,
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
    this.bindings = config.serviceBindings ?? {};
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

  /**
   * Get the WS proxy adapter for hosted-mode service bindings.
   * Uses the runtime's built-in adapter which sends service proxy
   * requests over the same WebSocket that carries WFE protocol messages.
   * In hosted mode, this WebSocket points to the provider-proxy.
   */
  getWSProxyAdapter(): WSProxyAdapter {
    return this.runtime.getWSProxyAdapter();
  }

  /**
   * Get all configured service bindings.
   */
  getServiceBindings(): ServiceBindingsMap {
    return { ...this.bindings };
  }

  /**
   * Get the raw ServiceBindingConfig for a named binding.
   * Throws if the binding is not found.
   */
  getServiceBinding(name: string): ServiceBindingConfig {
    const binding = this.bindings[name];
    if (!binding) {
      throw new Error(
        `Service binding '${name}' not found. ` +
          `Available bindings: ${Object.keys(this.bindings).join(", ") || "(none)"}`,
      );
    }
    return binding;
  }

  /**
   * Resolve a named service binding into a discriminated ServiceClientOptions.
   *
   * The returned object has a `transport` discriminator:
   * - `'http'`     — direct Axios transport (external/local mode)
   * - `'ws-proxy'` — WebSocket proxy transport (hosted mode)
   *
   * Pass the result to a typed client constructor that extends ServiceClient.
   */
  getServiceClientOptions(name: string): ServiceClientOptions {
    const binding = this.getServiceBinding(name);

    switch (binding.bindingType) {
      case "hosted":
        return {
          transport: "ws-proxy",
          wsProxy: this.getWSProxyAdapter(),
          serviceType: binding.type,
          id: binding.id,
        };

      case "non-hosted":
        return {
          transport: "http",
          url: binding.url,
          auth: binding.auth,
          maxRetries: binding.maxRetries,
          timeout: binding.timeout,
        };

      default: {
        const _exhaustive: never = binding;
        throw new Error(
          `Service binding '${name}' has unknown bindingType: ${(_exhaustive as ServiceBindingConfig).bindingType}`,
        );
      }
    }
  }
}
