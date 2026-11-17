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

import { newLogger } from '@kaleido-io/core-sdk/log';
import type { SetupContext } from '@kaleido-io/core-sdk/context';
import type { EventProcessorEvent, EventProcessorContext } from '@kaleido-io/workflow-engine-sdk';
import { CantonConnectorClient, isCompletionFailed } from '@kaleido-io/connector-sdk/canton';
import { SubledgerClient } from '@kaleido-io/subledger-sdk';
import type { CantonStreamEvent, CantonUpdateEvent } from './types.js';
import { formatCompletionFailure } from './helpers.js';
import { contractsToLookUp, mapBatch } from '../subledger/mapping.js';
import { ensureChain, stateLabels, write, type Subledger } from '../subledger/client.js';
import type { CantonConfig } from '../config.js';

const log = newLogger('canton-cip56-indexer');

export const DEFAULT_BINDING = 'subledger';
export const DEFAULT_CHAIN = 'canton';
export const DEFAULT_SOURCE = 'canton-cip56-indexer';

/** Builds the subledger client for a context; replaced by a fake in tests. */
export type SubledgerFactory = (ctx: SetupContext<CantonConfig>, bindingName: string) => Subledger;
const sdkClient: SubledgerFactory = (ctx, bindingName) => new SubledgerClient(ctx as SetupContext, bindingName);

const BUILDER_DEFAULTS = { defaults: { updateStrategy: 'create_or_ignore', labelStrategy: 'create_or_update' } } as const;

/**
 * CIP-56 event processor: indexes Canton ledger updates into the Kaleido Token Subledger.
 * The mapping is in ../subledger/mapping.ts.
 *
 * Per Workflow Engine batch:
 *   1. Split   — print `completion_failed` events (rejected commands have no ledger events);
 *                keep the ledger updates (an update is never split across batches).
 *   2. Look up — the State labels of contracts archived here but created in an earlier batch
 *                (one query; the only read, and no cache).
 *   3. Map     — every update to rows: evidence (transactions, events, states), registry
 *                (parties, wallets, assets), token (tokens, coins, locks, transfers).
 *   4. Write   — two bulk requests in order: everything else, then the endings (archivals,
 *                coin spends, lock releases). All create_or_ignore: a redelivery is harmless.
 */
export class CantonCIP56Indexer {
  constructor(private readonly clientOf: SubledgerFactory = sdkClient) {}

  private target(ctx: SetupContext<CantonConfig>) {
    const cfg = ctx.config?.subledger ?? {};
    return {
      client: this.clientOf(ctx, cfg.bindingName?.trim() || DEFAULT_BINDING),
      chain: cfg.chain?.trim() || DEFAULT_CHAIN,
      source: cfg.source?.trim() || DEFAULT_SOURCE,
    };
  }

  async setup(ctx: SetupContext<CantonConfig>): Promise<void> {
    const { client, chain } = this.target(ctx);
    await ensureChain(client, chain);
    log.info(`subledger chain '${chain}' ready`);
    if (ctx.config.stream) {
      await new CantonConnectorClient(ctx.config.stream.connectorBindingName).ensureStream(ctx, {
        factory: ctx.config.stream.factory,
        name: ctx.config.stream.name,
        description: ctx.config.stream.description,
        eventSourceConfig: ctx.config.stream.eventSourceConfig,
      });
    }
  }

  async processBatch(
    ctx: EventProcessorContext<CantonConfig>,
    batch: EventProcessorEvent<CantonStreamEvent>[],
  ): Promise<void> {
    const updates: CantonUpdateEvent[] = [];
    for (const event of batch) {
      if (isCompletionFailed(event.data)) log.warn(formatCompletionFailure(event.data));
      else if (event.data.events?.length) updates.push(event.data);
    }
    if (updates.length === 0) return;

    const { client, chain, source } = this.target(ctx as unknown as SetupContext<CantonConfig>);
    const lookUp = contractsToLookUp(updates);
    const prior = lookUp.length ? await stateLabels(client, chain, lookUp) : new Map<string, Record<string, string>>();

    const first = client.getNewBulkUpsertBuilder(BUILDER_DEFAULTS);
    const endings = client.getNewBulkUpsertBuilder(BUILDER_DEFAULTS);
    const counts = mapBatch(updates, prior, { chain, source }, first, endings);

    await write(client, 'write', first.toBulkUpsert());
    await write(client, 'write endings', endings.toBulkUpsert());
    log.info(
      `offsets ${updates[0].offset}..${updates[updates.length - 1].offset}: ` +
        Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') +
        (lookUp.length ? ` (${prior.size}/${lookUp.length} earlier contracts found)` : ''),
    );
  }
}
