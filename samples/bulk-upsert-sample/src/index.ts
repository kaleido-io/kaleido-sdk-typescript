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

/**
 * BulkUpsertBuilder sample.
 *
 * Demonstrates:
 *   - Idempotent setup of an asset and pool (create_or_ignore)
 *   - Building a batch of 100 randomised transfers via BulkUpsertBuilder
 *   - Automatic address deduplication: each wallet address appears only once
 *     in the payload regardless of how many transfers reference it
 *   - A finalizer that runs after execution and prints a per-address summary
 *   - bulkQuery to read back the demo asset, pool, and a page of transfers in one request
 *
 * Configuration:
 *   Copy config/provider-config.yaml.example → config/provider-config.yaml
 *   and fill in your Asset Manager endpoint and credentials.
 *
 * Run with:
 *   npm start
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { AssetManagerClient, BulkUpsertBuilder, TransferBulkInput } from '@kaleido-io/asset-manager-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

interface ProviderConfig {
  assetManager: {
    url: string;
    auth: { username: string; password: string };
  };
}

function loadConfig(): ProviderConfig {
  const configPath = path.resolve(__dirname, '../config/provider-config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
      `Copy config/provider-config.yaml.example → config/provider-config.yaml and fill in your credentials.`,
    );
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown>;

  const am = parsed?.assetManager as Record<string, unknown> | undefined;
  const auth = am?.auth as Record<string, unknown> | undefined;
  const url = typeof am?.url === 'string' ? am.url : '';
  const username = typeof auth?.username === 'string' ? auth.username : '';
  const password = typeof auth?.password === 'string' ? auth.password : '';

  if (!url || !username || !password) {
    throw new Error('provider-config.yaml: assetManager.url, auth.username, and auth.password are required');
  }

  return { assetManager: { url, auth: { username, password } } };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TRANSFER_COUNT = 100;
const WALLET_COUNT = 20;

const DEMO_ASSET_NAME = 'bulk-upsert-demo-asset';
const DEMO_POOL_NAME = 'bulk-upsert-demo-pool';
const DEMO_POOL_ADDRESS = '0x0000000000000000000000000000000000000001';
const DEMO_POOL_REF = `${DEMO_POOL_ADDRESS}/${DEMO_POOL_NAME}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomAddress(): string {
  return '0x' + randomBytes(20).toString('hex');
}

function randomHex32(): string {
  return '0x' + randomBytes(32).toString('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const config = loadConfig();
const { url, auth } = config.assetManager;

console.log(`[bulk-upsert-demo] Connecting to: ${url}`);

const amClient = new AssetManagerClient({
  transport: 'http',
  url,
  auth: { type: 'basic', username: auth.username, password: auth.password },
});

// ─── Step 1: ensure the demo asset and pool exist ────────────────────────────

console.log('[bulk-upsert-demo] Ensuring demo asset and pool exist (create_or_ignore)…');

await amClient.bulkUpsert({
  assets: [
    {
      name: DEMO_ASSET_NAME,
      displayName: 'Bulk Upsert Demo Asset',
      info: { description: 'Created by the bulk-upsert-sample' },
      labels: { demo: 'true' },
      updateType: 'create_or_ignore',
    },
  ],
  addresses: [
    {
      address: DEMO_POOL_ADDRESS,
      contract: true,
      updateType: 'create_or_ignore',
    },
  ],
  pools: [
    {
      name: DEMO_POOL_NAME,
      asset: DEMO_ASSET_NAME,
      address: DEMO_POOL_ADDRESS,
      standard: 'ERC20',
      displayName: 'Bulk Upsert Demo Pool',
      labels: { demo: 'true' },
      updateType: 'create_or_ignore',
    },
  ],
});

console.log('[bulk-upsert-demo] Asset and pool are ready.');

// ─── Step 2: generate synthetic wallets ──────────────────────────────────────

const wallets: string[] = Array.from({ length: WALLET_COUNT }, randomAddress);
console.log(`[bulk-upsert-demo] Generated ${WALLET_COUNT} synthetic wallet addresses.`);

// ─── Step 3: build 100 transfers ─────────────────────────────────────────────
//
// BulkUpsertBuilder deduplicates address entries: even though many transfers
// share the same wallets, each address appears at most once in the final
// payload sent to the API.

const builder = new BulkUpsertBuilder(amClient);
const transfers: TransferBulkInput[] = [];
const now = Date.now();

for (let i = 0; i < TRANSFER_COUNT; i++) {
  const from = wallets[Math.floor(Math.random() * WALLET_COUNT)];
  const to = wallets[Math.floor(Math.random() * WALLET_COUNT)];
  const amount = String(Math.floor(Math.random() * 1_000_000) + 1);
  const txHash = randomHex32();
  const blockNumber = 1_000_000 + i;
  const blockTimestamp = String(now + i * 12_000);

  const transfer: TransferBulkInput = {
    protocolId: `${blockNumber}/${txHash}/0`,
    from,
    to,
    amount,
    transactionHash: txHash,
    parent: { type: 'pool', ref: DEMO_POOL_REF },
    info: { blockNumber: String(blockNumber), blockTimestamp },
    balanceChanges: [
      { address: from, operation: 'subtract', amount },
      { address: to, operation: 'add', amount },
    ],
    labels: { demo: 'true' },
    updateType: 'create_or_replace',
  };

  builder.upsertAddress({ address: from, updateType: 'create_or_ignore' });
  builder.upsertAddress({ address: to, updateType: 'create_or_ignore' });
  builder.upsertTransfer(transfer);

  transfers.push(transfer);
}

// ─── Step 4: finalizer — print per-address transfer summary ──────────────────

builder.addFinalizer(() => {
  interface AddressStat {
    sent: number;
    received: number;
    netFlow: bigint;
  }

  const stats = new Map<string, AddressStat>();

  const get = (addr: string): AddressStat =>
    stats.get(addr) ?? stats.set(addr, { sent: 0, received: 0, netFlow: 0n }).get(addr)!;

  for (const t of transfers) {
    const amount = BigInt(t.amount ?? '0');
    if (t.from) {
      const s = get(t.from);
      s.sent++;
      s.netFlow -= amount;
    }
    if (t.to) {
      const s = get(t.to);
      s.received++;
      s.netFlow += amount;
    }
  }

  console.log('\n[bulk-upsert-demo] Transfer summary by address:');
  console.log('─'.repeat(100));
  console.log(
    `${'Address'.padEnd(44)}  ${'Sent'.padStart(6)}  ${'Received'.padStart(8)}  ${'Net flow'.padStart(22)}`,
  );
  console.log('─'.repeat(100));

  for (const [address, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sign = s.netFlow >= 0n ? '+' : '';
    console.log(
      `${address}  ${String(s.sent).padStart(6)}  ${String(s.received).padStart(8)}  ${(sign + s.netFlow).padStart(22)}`,
    );
  }

  console.log('─'.repeat(100));
  console.log(
    `${'TOTAL'.padEnd(44)}  ${String(transfers.reduce((n, t) => n + (t.from ? 1 : 0), 0)).padStart(6)}  ` +
    `${String(transfers.reduce((n, t) => n + (t.to ? 1 : 0), 0)).padStart(8)}`,
  );
});

// ─── Step 5: execute ─────────────────────────────────────────────────────────

console.log(
  `\n[bulk-upsert-demo] Executing bulk upsert: ${TRANSFER_COUNT} transfers, ` +
  `up to ${WALLET_COUNT} deduplicated wallet addresses…`,
);

await builder.execute();

// ─── Step 6: bulkQuery — read back several collections in one round-trip ─────
//
// BulkQueryInput accepts optional query specs per collection (assets, pools,
// transfers, …). Each uses DataModelQueryJSON filters (equal / eq / labels / …).

console.log('\n[bulk-upsert-demo] Running bulkQuery (asset + pool + demo transfers)…');

const queryResult = await amClient.bulkQuery({
  assets: {
    equal: [{ field: 'name', value: DEMO_ASSET_NAME }],
    limit: 1,
  },
  pools: {
    equal: [{ field: 'name', value: DEMO_POOL_NAME }],
    limit: 1,
  },
  transfers: {
    labels: {
      equal: [{ field: 'demo', value: 'true' }],
    },
    limit: 10,
    sort: ['created'],
  },
});

console.log(
  `[bulk-upsert-demo] bulkQuery counts — assets: ${queryResult.assets?.count ?? 0}, ` +
    `pools: ${queryResult.pools?.count ?? 0}, transfers (page): ${queryResult.transfers?.count ?? 0}` +
    (queryResult.transfers?.total != null ? ` (reported total=${queryResult.transfers.total})` : ''),
);

const assetRow = queryResult.assets?.items?.[0];
const poolRow = queryResult.pools?.items?.[0];
if (assetRow) {
  console.log(`[bulk-upsert-demo]   asset: ${assetRow.name} (${assetRow.id})`);
}
if (poolRow) {
  console.log(`[bulk-upsert-demo]   pool: ${poolRow.name} (${poolRow.id})`);
}

const transferItems = queryResult.transfers?.items ?? [];
if (transferItems.length > 0) {
  const t = transferItems[0];
  const tx = t.transactionHash ?? '';
  console.log(
    `[bulk-upsert-demo]   first transfer in page: protocolId=${t.protocolId} tx=${tx.slice(0, 18)}…`,
  );
}

console.log('[bulk-upsert-demo] Done.');
