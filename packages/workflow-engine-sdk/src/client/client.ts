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

import * as fs from 'fs';
import yaml from 'js-yaml';
import {
  HandlerRuntime,
  HandlerRuntimeConfig,
} from '../runtime/handler_runtime';
import {
  TransactionHandler,
  EventSource,
  EventProcessor,
} from '../interfaces/handlers';
import { ServiceBindingsMap, ServiceBindingConfig } from '../service/types';
import { ServiceClientOptions } from '@kaleido-io/core-sdk/http';
import { WSProxyAdapter } from '../service/ws_proxy_adapter';
import { ConfigLoader, KALEIDO_CONFIG_FILE, WFE_CONFIG_FILE, CONFIG_FILE } from '../config/config';
import { newLogger } from '@kaleido-io/core-sdk/log';
import { createEventProcessorBase, EventProcessorEvent } from '../factories/event_processor';
import { RequestContext } from '../types/core';
import {
  SetupContext,
  createSetupContext,
} from '@kaleido-io/core-sdk/context';
import { createEventProcessorContext } from '../app/context';
import type { EventProcessorDef, TransactionHandlerRegistration } from '../app/types';

const log = newLogger('WorkflowEngineClient');

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

type RegisteredHandler =
  | { name: string; type: 'eventProcessor'; def: EventProcessorDef<unknown, unknown> }
  | { name: string; type: 'transactionHandler'; def: TransactionHandlerRegistration }
  | { name: string; type: 'eventSource'; source: EventSource };

export class WorkflowEngineClient<CustomConfig = unknown> {
  private runtime: HandlerRuntime;
  private bindings: ServiceBindingsMap;
  private readonly wfeConfig: WorkflowEngineClientConfig;
  private readonly customConfig: CustomConfig;
  private readonly registeredHandlers: RegisteredHandler[] = [];

  constructor(config: WorkflowEngineClientConfig, customConfig?: CustomConfig) {
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
    this.wfeConfig = config;
    this.customConfig = (customConfig ?? {}) as CustomConfig;
  }

  // ── Builder API ─────────────────────────────────────────────────────────────

  /**
   * Load config from a YAML file and return a configured client.
   *
   * File path resolution order:
   *   1. `path` argument
   *   2. `KALEIDO_CONFIG_FILE` env var
   *   3. `WFE_CONFIG_FILE` env var (legacy)
   */
  static fromConfigFile<C = unknown>(path?: string): WorkflowEngineClient<C> {
    const wfeClientConfig = ConfigLoader.loadClientConfigFromFile(path);
    const serviceBindings = ConfigLoader.loadServiceBindings(path);
    if (Object.keys(serviceBindings).length > 0) {
      wfeClientConfig.serviceBindings = serviceBindings;
    }

    // Resolve the provider-specific ("custom") config file.
    //
    // Newer platforms set CONFIG_FILE to the exact mount path of the fileSet
    // config (typically /etc/provider/config.{yaml,json}); older platforms
    // don't set it at all, so we also probe both the historical dev-loop
    // default (./config/provider-config.yaml, matching sample templates) and
    // the operator's DefaultConfigFileMountDir (/etc/provider/config.{yaml,json})
    // to cope with a platform that mounts the file but hasn't yet been
    // upgraded to emit CONFIG_FILE.
    const providerConfigCandidates = [
      process.env[CONFIG_FILE],
      './config/provider-config.yaml',
      '/etc/provider/config.yaml',
      '/etc/provider/config.json',
    ].filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim());

    let customConfig: C = {} as C;
    let loadedFromProviderFile = false;
    for (const candidate of providerConfigCandidates) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        customConfig = (yaml.load(raw) ?? {}) as C;
        loadedFromProviderFile = true;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!loadedFromProviderFile) {
      // Fall back to a `config:` key inside the KALEIDO_CONFIG_FILE. This is
      // the historical single-file layout used before the operator started
      // mounting the fileSet at /etc/provider.
      const kaleidoConfigPath = (
        path ??
        process.env[KALEIDO_CONFIG_FILE] ??
        process.env[WFE_CONFIG_FILE] ??
        ''
      ).trim();
      if (kaleidoConfigPath) {
        try {
          const raw = fs.readFileSync(kaleidoConfigPath, 'utf8');
          const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
          customConfig = ((parsed?.['config']) ?? {}) as C;
        } catch {
          // no custom config section is fine
        }
      }
    }

    return new WorkflowEngineClient<C>(wfeClientConfig, customConfig);
  }

  /** @internal For unit tests — creates a client with a stub config, no file I/O. */
  static _createForTest<C = unknown>(
    customConfig: C = {} as C,
    wfeConfig: WorkflowEngineClientConfig = { providerName: 'test-provider' },
  ): WorkflowEngineClient<C> {
    return new WorkflowEngineClient<C>(wfeConfig, customConfig);
  }

  /**
   * Register an event processor handler.
   * The handler name must be unique within this client.
   */
  eventProcessor<C = CustomConfig, E = unknown>(name: string, def: EventProcessorDef<C, E>): this {
    this.assertUniqueHandlerName(name);
    this.registeredHandlers.push({ name, type: 'eventProcessor', def: def as EventProcessorDef<unknown, unknown> });
    return this;
  }

  /**
   * Register a WFE transaction handler.
   * The handler name must be unique within this client.
   */
  transactionHandler(name: string, def: TransactionHandlerRegistration): this {
    this.assertUniqueHandlerName(name);
    this.registeredHandlers.push({ name, type: 'transactionHandler', def });
    return this;
  }

  /**
   * Register a WFE event source.
   * The handler name is taken from `source.name` and must be unique within this client.
   */
  eventSource(source: EventSource): this {
    const name = source.name;
    this.assertUniqueHandlerName(name);
    this.registeredHandlers.push({ name, type: 'eventSource', source });
    return this;
  }

  /**
   * Run all handler `setup` hooks, then exit without connecting to WFE.
   * Use this as an init-container / migration step.
   */
  async setup(): Promise<void> {
    const controller = new AbortController();
    await this.runSetupHooks(controller.signal);
    controller.abort();
  }

  /**
   * Connect to WFE and register handlers. Setup lifecycle depends on the
   * provider's service bindings:
   *
   * - If ANY binding is `hosted`, setup hooks are deferred until the provider-
   *   proxy dispatches a SETUP_TRIGGER_REQUEST (issued by a user-initiated
   *   POST /providers/{name}/setup). That trigger carries an authRef bound to
   *   the caller's JWT so hosted-binding calls inside setup() authenticate as
   *   that user.
   * - If all bindings are non-hosted (or none are declared), hooks run at
   *   boot immediately after connect. Non-hosted transports carry their own
   *   credentials in config, so no per-request authRef is needed.
   *
   * The trigger handler is always registered so that a stray trigger against
   * a non-hosted deployment still gets a well-formed response.
   *
   * For init-container / migration use where no WFE connection is wanted at
   * all, call `setup()` directly instead of `start()`.
   */
  async start(): Promise<void> {
    this.registerBuilderHandlers();
    // Declare per-provider capabilities on the WS. Computed here (after
    // registerBuilderHandlers ran, before connect() opens the socket) so the
    // very first REGISTER_PROVIDER message carries the flags. On reconnect the
    // runtime re-sends the same declared value.
    this.runtime.setProviderCapabilities({
      hasSetupHooks: this.hasAnySetupHook(),
    });
    this.runtime.registerSetupTriggerHandler((authRef) => this.runSetupOnTrigger(authRef));
    await this.connect();
    if (this.hasAnyHostedBinding()) {
      log.info('Hosted service bindings present: deferring setup hooks until SETUP_TRIGGER_REQUEST');
      return;
    }
    log.info('No hosted service bindings: running setup hooks at boot');
    const controller = new AbortController();
    await this.runSetupHooks(controller.signal);
  }

  private hasAnyHostedBinding(): boolean {
    return Object.values(this.bindings).some((b) => b.bindingType === 'hosted');
  }

  /** @internal — invoked by the runtime when SETUP_TRIGGER_REQUEST arrives. */
  async runSetupOnTrigger(authRef: string): Promise<{ status: 'success' | 'error'; errors?: string[] }> {
    const controller = new AbortController();
    const errors: string[] = [];
    try {
      for (const registered of this.registeredHandlers) {
        if (registered.type === 'eventSource') continue;
        const { name, def } = registered;
        if (!def.setup) continue;
        log.info(`Running setup hook for handler '${name}' (triggered, authRef=${authRef ? authRef.substring(0, 8) + '...' : '(none)'})`);
        const ctx = this.buildSetupContext(name, controller.signal, authRef);
        try {
          await def.setup(ctx as SetupContext<unknown>);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${name}: ${msg}`);
          log.error(`Setup hook '${name}' failed`, { error: msg });
        }
      }
    } finally {
      controller.abort();
    }
    return errors.length === 0 ? { status: 'success' } : { status: 'error', errors };
  }

  /**
   * Disconnect from WFE.
   */
  stop(): void {
    this.disconnect();
  }

  // ── Low-level registration API (used by newWorkflowEngineClient) ────────────

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

  get isConnected(): boolean {
    return this.runtime.isWebSocketConnected;
  }

  getWSProxyAdapter(): WSProxyAdapter {
    return this.runtime.getWSProxyAdapter();
  }

  getServiceBindings(): ServiceBindingsMap {
    return { ...this.bindings };
  }

  getServiceBinding(name: string): ServiceBindingConfig {
    const binding = this.bindings[name];
    if (!binding) {
      throw new Error(
        `Service binding '${name}' not found. ` +
          `Available bindings: ${Object.keys(this.bindings).join(', ') || '(none)'}`,
      );
    }
    return binding;
  }

  getServiceClientOptions(name: string, authRef?: string): ServiceClientOptions {
    const binding = this.getServiceBinding(name);

    switch (binding.bindingType) {
      case 'hosted':
        return {
          transport: 'ws-proxy',
          wsProxy: this.getWSProxyAdapter(),
          serviceType: binding.type,
          id: binding.id,
          authRef,
        };

      case 'non-hosted':
        return {
          transport: 'http',
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

  // ── Private builder helpers ──────────────────────────────────────────────────

  private buildSetupContext(handlerName: string, signal: AbortSignal, authRef?: string): SetupContext<CustomConfig> {
    return createSetupContext(
      (name) => this.getServiceClientOptions(name, authRef),
      this.customConfig,
      this.wfeConfig.providerName,
      handlerName,
      signal,
    );
  }

  private async runSetupHooks(signal: AbortSignal): Promise<void> {
    for (const registered of this.registeredHandlers) {
      if (registered.type === 'eventSource') continue;
      const { name, def } = registered;
      if (def.setup) {
        log.info(`Running setup hook for handler '${name}'`);
        const ctx = this.buildSetupContext(name, signal);
        await def.setup(ctx as SetupContext<unknown>);
      }
    }
  }

  private registerBuilderHandlers(): void {
    for (const registered of this.registeredHandlers) {
      if (registered.type === 'eventProcessor') {
        const { name, def } = registered;
        this.registerEventProcessor(
          name,
          createEventProcessorBase(
            name,
            async (reqCtx: RequestContext, events: EventProcessorEvent<unknown>[]) => {
              // Use the per-request signal so the batch observes the request
              // deadline / cancellation — not a start-level signal that is never aborted.
              const setupCtx = this.buildSetupContext(name, reqCtx.signal, reqCtx.authRef);
              const ctx = createEventProcessorContext(setupCtx, reqCtx.requestId);
              return def.processBatch(ctx, events);
            },
          ),
        );
      } else if (registered.type === 'transactionHandler') {
        const { name, def } = registered;
        this.registerTransactionHandler(name, def.handler);
      } else if (registered.type === 'eventSource') {
        this.registerEventSource(registered.name, registered.source);
      }
    }
  }

  private assertUniqueHandlerName(name: string): void {
    if (this.registeredHandlers.some((h) => h.name === name)) {
      throw new Error(`Handler '${name}' is already registered`);
    }
  }

  /**
   * True iff at least one registered handler defines a `setup` hook. Event
   * sources are excluded because the EventSource interface has no `setup`
   * concept. Called at start() time to populate ProviderCapabilities.
   */
  private hasAnySetupHook(): boolean {
    return this.registeredHandlers.some(
      (h) => h.type !== 'eventSource' && (h.def as { setup?: unknown }).setup != null,
    );
  }
}
