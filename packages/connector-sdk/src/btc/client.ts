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

import type { SetupContext } from '@kaleido-io/core/context';
import { ensureStream } from '@kaleido-io/workflow-engine-sdk';
import { ConfigLoader } from '@kaleido-io/workflow-engine-sdk';
import type { BTCTransactionEventsConfig } from './stream-config.js';

/**
 * Helper client for setting up streams on the Kaleido BTC Connector.
 * Wraps ensureStream with the connector binding name so callers do not need
 * to repeat it at every call site.
 */
export class BTCConnectorClient {
  static fromConfigFile(
    bindingName: string = 'btc-connector',
    configFilePath?: string,
  ): BTCConnectorClient {
    const bindings = ConfigLoader.loadServiceBindings(configFilePath);
    if (Object.keys(bindings).length > 0 && !bindings[bindingName]) {
      throw new Error(
        `Service binding '${bindingName}' not found. Available bindings: ${Object.keys(bindings).join(', ') || '(none)'}`,
      );
    }
    return new BTCConnectorClient(bindingName);
  }

  constructor(private readonly bindingName: string = 'btc-connector') {
  }

  /**
   * Idempotently create or update a transactionEvents stream on the BTC Connector.
   *
   * @param ctx - The handler setup context providing provider identity and service client options.
   * @param opts - Stream factory name, unique stream name, event source config, and optional description.
   */
  async ensureStream(
    ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>,
    opts: {
      factory: string;
      name: string;
      eventSourceConfig: BTCTransactionEventsConfig;
      description?: string;
    },
  ): Promise<void> {
    await ensureStream(ctx, {
      connectorBindingName: this.bindingName,
      factory: opts.factory,
      name: opts.name,
      eventSourceConfig: opts.eventSourceConfig,
      description: opts.description,
    });
  }
}
