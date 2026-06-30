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
  resolveServiceBindingFromMap,
  type ServiceClientOptions,
  type ServiceBindingsMap,
} from '@kaleido-io/core';
import {
  WorkflowEngineClient,
  ConfigLoader,
  type WorkflowEngineClientConfig,
} from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import {
  EVMConnectorClient,
  BTCConnectorClient,
  CantonConnectorClient,
} from '@kaleido-io/connector-sdk';

/**
 * Configuration for {@link KaleidoClient}.
 *
 * The two concerns are modeled separately:
 *
 * - `workflowEngine` — the special primary Workflow Engine connection used when
 *   running *as a provider* (inbound/outbound websocket, provider identity).
 *   Optional: omit it for apps that only talk to non-hosted service bindings.
 * - `serviceBindings` — the named hosted and/or non-hosted bindings
 *   (asset-manager, connectors, key-manager, ...). Non-hosted bindings resolve
 *   to direct HTTP and need no Workflow Engine connection at all; hosted
 *   bindings tunnel through the primary Workflow Engine connection.
 */
export interface KaleidoClientConfig {
  workflowEngine?: WorkflowEngineClientConfig;
  serviceBindings?: ServiceBindingsMap;
}

/**
 * Convenience facade over the individual Kaleido SDKs.
 *
 * ```ts
 * const client = KaleidoClient.fromConfigFile();        // env-driven (KALEIDO_CONFIG_FILE)
 * const am = client.assetManagerClient();               // 'asset-manager' binding
 * const am2 = client.assetManagerClient('asset-manager-2');
 * const wfe = client.workflowEngineClient();            // primary provider connection
 * ```
 *
 * The facade delegates entirely to the underlying SDK packages and adds no new
 * transport behaviour of its own. It depends on `@kaleido-io/core` only at build
 * time (its binding-resolution types and helpers), not as a runtime dependency.
 */
export class KaleidoClient {
  private readonly wfeConfig?: WorkflowEngineClientConfig;
  private readonly bindings: ServiceBindingsMap;
  private wfe?: WorkflowEngineClient;
  private readonly assetManagers = new Map<string, AssetManagerClient>();

  constructor(config: KaleidoClientConfig = {}) {
    this.wfeConfig = config.workflowEngine;
    this.bindings = config.serviceBindings ?? {};
  }

  /**
   * Build a KaleidoClient from a Kaleido YAML config file.
   *
   * Path resolution mirrors the individual SDKs: the `path` argument, then the
   * `KALEIDO_CONFIG_FILE` env var (operator-written), then `WFE_CONFIG_FILE`.
   * The typical hosted invocation is `KaleidoClient.fromConfigFile()` with no
   * argument, relying on the operator-provided env var.
   *
   * Service bindings are always loaded (tolerant of absence). The primary
   * workflow-engine connection is loaded when present; a config that only
   * declares service-bindings (no `workflow-engine` section) yields a client
   * with no primary connection — fully usable for non-hosted bindings.
   */
  static fromConfigFile(path?: string): KaleidoClient {
    const serviceBindings = ConfigLoader.loadServiceBindings(path);

    let workflowEngine: WorkflowEngineClientConfig | undefined;
    try {
      workflowEngine = ConfigLoader.loadClientConfigFromFile(path);
      if (Object.keys(serviceBindings).length > 0) {
        workflowEngine.serviceBindings = serviceBindings;
      }
    } catch {
      // No primary workflow-engine connection in the config — this is a valid
      // non-hosted-only configuration. Leave `workflowEngine` undefined.
      workflowEngine = undefined;
    }

    return new KaleidoClient({ workflowEngine, serviceBindings });
  }

  /**
   * The primary Workflow Engine connection (memoized).
   *
   * This is the special provider connection, not a service binding. Throws if no
   * `workflowEngine` config was supplied.
   */
  workflowEngineClient(): WorkflowEngineClient {
    if (!this.wfe) {
      if (!this.wfeConfig) {
        throw new Error(
          'No primary workflow-engine connection configured. Provide `workflowEngine` in ' +
            'the KaleidoClient config (or a `workflow-engine` section in the config file) ' +
            'before calling workflowEngineClient().',
        );
      }
      this.wfe = new WorkflowEngineClient(this.wfeConfig);
    }
    return this.wfe;
  }

  /**
   * Typed Asset Manager client for the given binding (default `asset-manager`),
   * memoized per binding name. Non-hosted bindings work without connecting;
   * hosted bindings require a connected primary Workflow Engine connection.
   */
  assetManagerClient(bindingName = 'asset-manager'): AssetManagerClient {
    let client = this.assetManagers.get(bindingName);
    if (!client) {
      client = new AssetManagerClient(this.resolveBinding(bindingName));
      this.assetManagers.set(bindingName, client);
    }
    return client;
  }

  /** EVM connector helper for the given binding (default `evm-connector`). */
  evmConnectorClient(bindingName = 'evm-connector'): EVMConnectorClient {
    return new EVMConnectorClient(bindingName);
  }

  /** BTC connector helper for the given binding (default `btc-connector`). */
  btcConnectorClient(bindingName = 'btc-connector'): BTCConnectorClient {
    return new BTCConnectorClient(bindingName);
  }

  /** Canton connector helper for the given binding (default `canton-connector`). */
  cantonConnectorClient(bindingName = 'canton-connector'): CantonConnectorClient {
    return new CantonConnectorClient(bindingName);
  }

  /** Connect the primary Workflow Engine connection (required for hosted bindings). */
  async connect(): Promise<void> {
    await this.workflowEngineClient().connect();
  }

  /** Disconnect the primary Workflow Engine connection, if one was created. */
  disconnect(): void {
    this.wfe?.disconnect();
  }

  /** Snapshot of the configured service bindings. */
  getServiceBindings(): ServiceBindingsMap {
    return { ...this.bindings };
  }

  private resolveBinding(name: string): ServiceClientOptions {
    const binding = this.bindings[name];
    if (!binding) {
      throw new Error(
        `Service binding '${name}' not found. ` +
          `Available bindings: ${Object.keys(this.bindings).join(', ') || '(none)'}`,
      );
    }
    // Hosted bindings tunnel through the primary WFE ws-proxy adapter (which
    // requires a live connection); non-hosted bindings resolve to direct HTTP
    // with no WFE involvement.
    const wsProxy =
      binding.bindingType === 'hosted'
        ? this.workflowEngineClient().getWSProxyAdapter()
        : undefined;
    return resolveServiceBindingFromMap(binding, wsProxy);
  }
}
