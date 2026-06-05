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

import { newLogger } from '@kaleido-io/workflow-engine-sdk';
import type { SetupContext } from '../app/context.js';
import { ConnectorClient } from './connector-client.js';

const log = newLogger('ensureStream');

export interface EnsureStreamOptions {
  /** Name of the service binding (in config `service-bindings`) for the connector. */
  connectorBindingName: string;
  /** Stream factory name (e.g. `transactionEvents`). */
  factory: string;
  /** Unique stream name. Used as an idempotent key for upsert. */
  name: string;
  /** Optional human-readable description. */
  description?: string;
  /** Connector-specific event source configuration. */
  eventSourceConfig: unknown;
}

/**
 * Idempotently create or update a WFE stream on the named connector.
 *
 * Call this from a handler's `setup` hook:
 * ```ts
 * setup: async (ctx) => {
 *   await ensureStream(ctx, {
 *     connectorBindingName: 'btc-connector',
 *     factory: 'transactionEvents',
 *     name: 'btc-mainnet',
 *     eventSourceConfig: { ... },
 *   });
 * }
 * ```
 */
export async function ensureStream(
  ctx: Pick<SetupContext<unknown>, 'providerName' | 'handlerName' | 'getServiceClientOptions'>,
  options: EnsureStreamOptions,
): Promise<void> {
  const { connectorBindingName, factory, name, description, eventSourceConfig } = options;

  const client = new ConnectorClient(ctx.getServiceClientOptions(connectorBindingName));

  const streamBody = {
    description,
    eventProcessor: {
      type: 'handler',
      handler: {
        provider: ctx.providerName,
        name: ctx.handlerName,
      },
    },
    eventSource: {
      type: 'handler',
      handler: {
        config: eventSourceConfig,
      },
    },
  };

  log.info(`Upserting stream '${name}' on factory '${factory}' for provider '${ctx.providerName}' handler '${ctx.handlerName}'`);
  const result = await client.putStream<{ id?: string }>(
    `/api/v1/stream-factories/${factory}/api/streams/${name}`,
    streamBody,
  );
  log.info(`Stream ready: id=${result?.id ?? name}`);
}
