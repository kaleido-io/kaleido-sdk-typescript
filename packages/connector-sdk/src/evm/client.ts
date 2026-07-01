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

import type { SetupContext } from '@kaleido-io/core-sdk/context';
import { ensureStream } from '@kaleido-io/workflow-engine-sdk';
import { ConfigLoader } from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEventsConfig } from './stream-config.js';

/**
 * High-level client for managing EVM connector streams.
 *
 * Instantiate with the service binding name configured for your EVM connector
 * in the WFE client config, then call `ensureStream` from a handler's `setup`
 * hook to idempotently create or update a transaction event stream.
 */
export class EVMConnectorClient {
  private readonly connectorBindingName: string;

  static fromConfigFile(
    bindingName: string = 'evm-connector',
    configFilePath?: string,
  ): EVMConnectorClient {
    const bindings = ConfigLoader.loadServiceBindings(configFilePath);
    if (Object.keys(bindings).length > 0 && !bindings[bindingName]) {
      throw new Error(
        `Service binding '${bindingName}' not found. Available bindings: ${Object.keys(bindings).join(', ') || '(none)'}`,
      );
    }
    return new EVMConnectorClient(bindingName);
  }

  constructor(bindingName: string = 'evm-connector') {
    this.connectorBindingName = bindingName;
  }

  /**
   * Idempotently create or update a WFE stream on the EVM connector.
   *
   * @param ctx - Setup context providing provider/handler identity and service client options.
   * @param opts - Stream factory, name, event source configuration, and optional description.
   */
  async ensureStream(
    ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>,
    opts: {
      factory: string;
      name: string;
      eventSourceConfig: EVMTransactionEventsConfig;
      description?: string;
    },
  ): Promise<void> {
    await ensureStream(ctx, {
      connectorBindingName: this.connectorBindingName,
      factory: opts.factory,
      name: opts.name,
      eventSourceConfig: opts.eventSourceConfig,
      description: opts.description,
    });
  }
}
