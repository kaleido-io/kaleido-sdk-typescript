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
  WorkflowEngineClient,
  WorkflowEngineClientConfig,
  ConfigLoader,
  createEventProcessor,
  EventProcessorEvent,
  RequestContext,
  newLogger,
} from '@kaleido-io/workflow-engine-sdk';
import { loadConfig } from '../config/config.js';
import { SetupContext, createSetupContext, createIndexerContext } from './context.js';
import type { IndexerHandlerDef, TransactionHandlerRegistration } from './types.js';

const log = newLogger('KaleidoApp');

type RegisteredHandler =
  | { name: string; type: 'indexer'; def: IndexerHandlerDef<unknown, unknown> }
  | { name: string; type: 'transactionHandler'; def: TransactionHandlerRegistration };

/**
 * Top-level application builder for Kaleido providers.
 *
 * ```ts
 * await KaleidoApp.fromConfigFile()
 *   .indexer('btc', {
 *     setup: async (ctx) => { await ensureStream(ctx, { ... }); },
 *     process: async (ctx, events) => { ... },
 *   })
 *   .start();
 * ```
 */
export class KaleidoApp<CustomConfig = unknown> {
  private readonly handlers: RegisteredHandler[] = [];
  private readonly wfeClientConfig: WorkflowEngineClientConfig;
  private readonly customConfig: CustomConfig;
  /** @internal override for unit tests */
  private readonly _clientFactory?: () => WorkflowEngineClient;

  private constructor(
    wfeClientConfig: WorkflowEngineClientConfig,
    customConfig: CustomConfig,
    _clientFactory?: () => WorkflowEngineClient,
  ) {
    this.wfeClientConfig = wfeClientConfig;
    this.customConfig = customConfig;
    this._clientFactory = _clientFactory;
  }

  /**
   * @internal For unit tests — inject a pre-built mock WFE client.
   */
  static _createForTest<C = unknown>(
    wfeClient: WorkflowEngineClient,
    customConfig: C,
  ): KaleidoApp<C> {
    const config: WorkflowEngineClientConfig = { providerName: 'test-provider' };
    return new KaleidoApp<C>(config, customConfig, () => wfeClient);
  }

  /**
   * Load config from a YAML file. The file must contain a `workflow-engine` section
   * and may contain a `service-bindings` section and a `config` section.
   *
   * File path resolution order:
   *   1. `path` argument
   *   2. `KALEIDO_CONFIG_FILE` env var
   *   3. `./config/config.yaml`
   */
  static fromConfigFile<C = unknown>(path?: string): KaleidoApp<C> {
    const wfeClientConfig = ConfigLoader.loadClientConfigFromFile(path);
    const serviceBindings = ConfigLoader.loadServiceBindings(path);
    wfeClientConfig.serviceBindings = serviceBindings;

    const rawConfig = loadConfig<Record<string, unknown>>(path);
    const customConfig = (rawConfig['config'] ?? {}) as C;

    return new KaleidoApp<C>(wfeClientConfig, customConfig);
  }

  /**
   * Register an event-processor indexer.
   * The handler name must be unique within this app.
   */
  indexer<C = CustomConfig, E = unknown>(
    name: string,
    def: IndexerHandlerDef<C, E>,
  ): this {
    this.assertUniqueHandlerName(name);
    this.handlers.push({ name, type: 'indexer', def: def as IndexerHandlerDef<unknown, unknown> });
    return this;
  }

  /**
   * Register a WFE transaction handler.
   * The handler name must be unique within this app.
   */
  transactionHandler(name: string, def: TransactionHandlerRegistration): this {
    this.assertUniqueHandlerName(name);
    this.handlers.push({ name, type: 'transactionHandler', def });
    return this;
  }

  /**
   * Run all handler `setup` hooks, then exit without connecting to WFE.
   * Use this as an init-container / migration step.
   */
  async setup(): Promise<void> {
    const { wfeClient, controller } = this.buildClient();
    await this.runSetupHooks(wfeClient, controller.signal);
    controller.abort();
  }

  /**
   * Run all handler `setup` hooks, register handlers, then connect to WFE.
   */
  async start(): Promise<void> {
    const { wfeClient, controller } = this.buildClient();
    await this.runSetupHooks(wfeClient, controller.signal);
    this.registerHandlers(wfeClient, controller.signal);
    await wfeClient.connect();
  }

  private buildClient(): { wfeClient: WorkflowEngineClient; controller: AbortController } {
    const controller = new AbortController();
    const wfeClient = this._clientFactory
      ? this._clientFactory()
      : new WorkflowEngineClient(this.wfeClientConfig);
    return { wfeClient, controller };
  }

  private buildSetupContext(
    wfeClient: WorkflowEngineClient,
    handlerName: string,
    signal: AbortSignal,
  ): SetupContext<CustomConfig> {
    return createSetupContext(
      wfeClient,
      this.customConfig,
      this.wfeClientConfig.providerName,
      handlerName,
      signal,
    );
  }

  private async runSetupHooks(wfeClient: WorkflowEngineClient, signal: AbortSignal): Promise<void> {
    for (const { name, def } of this.handlers) {
      if (def.setup) {
        log.info(`Running setup hook for handler '${name}'`);
        const ctx = this.buildSetupContext(wfeClient, name, signal);
        await def.setup(ctx as SetupContext<unknown>);
      }
    }
  }

  private registerHandlers(wfeClient: WorkflowEngineClient, signal: AbortSignal): void {
    for (const registered of this.handlers) {
      if (registered.type === 'indexer') {
        const { name, def } = registered;
        wfeClient.registerEventProcessor(
          name,
          createEventProcessor(
            name,
            async (reqCtx: RequestContext, events: EventProcessorEvent<unknown>[]) => {
              const setupCtx = this.buildSetupContext(wfeClient, name, signal);
              const ctx = createIndexerContext(setupCtx, reqCtx.requestId);
              return def.process(ctx, events);
            },
          ),
        );
      } else if (registered.type === 'transactionHandler') {
        const { name, def } = registered;
        wfeClient.registerTransactionHandler(name, def.handler);
      }
    }
  }

  private assertUniqueHandlerName(name: string): void {
    if (this.handlers.some((h) => h.name === name)) {
      throw new Error(`Handler '${name}' is already registered`);
    }
  }
}
