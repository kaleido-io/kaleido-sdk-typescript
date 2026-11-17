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
import type { BulkQueryInput, BulkUpsertInput, BulkUpsertOutput, SubledgerClient } from '@kaleido-io/subledger-sdk';

const log = newLogger('cip56-subledger');

/** The calls the indexer makes — the SDK's SubledgerClient, or a fake in tests. */
export type Subledger = Pick<SubledgerClient, 'bulkUpsert' | 'bulkQuery' | 'getNewBulkUpsertBuilder'>;

/** Chain transactions are ordered by offset; events by offset/index-in-update. Immutable once the chain exists. */
export const TX_SEQUENCE_LEVELS = 1;
export const EVENT_SEQUENCE_LEVELS = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The Retry-After of a 429 in ms (default 5 s), or undefined for any other error. */
export function retryAfterMs(e: unknown): number | undefined {
  const res = (e as { response?: { status?: number; headers?: Record<string, unknown> } } | undefined)?.response;
  if (res?.status !== 429) return undefined;
  const h = Number(res.headers?.['retry-after']);
  return Number.isFinite(h) && h > 0 ? Math.ceil(h * 1000) : 5_000;
}

/**
 * Run a subledger call, waiting out a 429's Retry-After (the endpoint rate-limits). Any other
 * error is thrown: the Workflow Engine redelivers the batch, and every write is idempotent.
 */
export async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const ms = retryAfterMs(e);
      if (ms === undefined || i >= attempts) throw e;
      log.warn(`${what}: rate limited (429), retrying in ${ms} ms (attempt ${i})`);
      await sleep(ms);
    }
  }
}

/** One bulk write. Sent as a body (not builder.execute()) so a retry resends the same rows. */
export function write(client: Subledger, what: string, body: BulkUpsertInput): Promise<BulkUpsertOutput | undefined> {
  if (Object.keys(body).length === 0) return Promise.resolve(undefined);
  return withRetry(what, () => client.bulkUpsert(body));
}

/** Create the Chain if missing, and check an existing one has the sequence depths we write. */
export async function ensureChain(client: Subledger, chain: string): Promise<void> {
  await write(client, 'ensureChain', {
    blockchain: {
      chains: {
        updateStrategy: 'create_or_ignore',
        labelStrategy: 'create_or_ignore',
        items: [{
          name: chain,
          transactionSequenceLevels: TX_SEQUENCE_LEVELS,
          eventSequenceLevels: EVENT_SEQUENCE_LEVELS,
          info: { ledger: 'canton', writer: 'canton-cip56-indexer' },
          labels: { ledger: 'canton' },
        }],
      },
    },
  } as BulkUpsertInput);
  const res = await withRetry('getChain', () =>
    client.bulkQuery({ blockchain: { chains: { equal: [{ field: 'name', value: chain }], limit: 1 } } }),
  );
  const c = res?.blockchain?.chains?.items?.[0];
  if (c?.transactionSequenceLevels !== TX_SEQUENCE_LEVELS || c?.eventSequenceLevels !== EVENT_SEQUENCE_LEVELS) {
    throw new Error(
      `subledger chain '${chain}' has transactionSequenceLevels=${c?.transactionSequenceLevels} ` +
        `eventSequenceLevels=${c?.eventSequenceLevels}; the indexer writes ${TX_SEQUENCE_LEVELS}/${EVENT_SEQUENCE_LEVELS} ` +
        `(immutable on a chain) — configure another subledger.chain`,
    );
  }
}

/** contract id -> the labels of its State, for the ids that have one (100 per query). */
export async function stateLabels(client: Subledger, chain: string, contractIds: string[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  for (let i = 0; i < contractIds.length; i += 100) {
    const values = contractIds.slice(i, i + 100);
    const query: BulkQueryInput = { blockchain: { states: [{ chainUrn: chain, in: [{ field: 'locator', values }], limit: values.length }] } };
    const res = await withRetry('stateLabels', () => client.bulkQuery(query));
    for (const st of res?.blockchain?.states?.[0]?.items ?? []) out.set(st.locator, st.labels ?? {});
  }
  return out;
}
