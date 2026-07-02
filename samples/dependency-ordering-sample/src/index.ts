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
 * Dependency-ordering sample.
 *
 * The Asset Manager enforces referential integrity: if a pool references an
 * asset that does not yet exist, the AM returns KA090801.
 *
 * BulkUpsertBuilder exposes two behaviours via the retryOnInvalidRef option:
 *
 *   false — KA090801 is thrown immediately to the caller. Use this when you
 *     want fast failure visibility and will handle ordering yourself.
 *
 *   true (default) — on KA090801 the builder retries items individually in
 *     repeated passes. If a full pass makes no progress, it throws
 *     BulkUpsertInvalidRefError with the stuck items for the caller to inspect.
 *
 * This sample demonstrates both behaviours by submitting a pool whose asset
 * dependency does not exist.
 *
 * Configuration:
 *   Copy config/provider-config.yaml.example → config/provider-config.yaml
 *
 * Run with:
 *   npm start
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  AssetManagerClient,
  BulkUpsertBuilder,
  BulkUpsertInvalidRefError,
} from '@kaleido-io/asset-manager-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

interface ProviderConfig {
  assetManager: { url: string; auth: { username: string; password: string } };
}

function loadConfig(): ProviderConfig {
  const configPath = path.resolve(__dirname, '../config/provider-config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
      `Copy config/provider-config.yaml.example → config/provider-config.yaml`,
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
    throw new Error('provider-config.yaml: url, auth.username, and auth.password are required');
  }
  return { assetManager: { url, auth: { username, password } } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function amErrorMessage(err: unknown): string {
  const body = (err as { response?: { data?: { error?: string } } }).response?.data;
  return body?.error ?? (err instanceof Error ? err.message : String(err));
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEMO_ASSET   = 'dep-order-demo-asset';
const DEMO_ADDRESS = '0x0000000000000000000000000000000000000002';
const DEMO_POOL    = 'dep-order-demo-pool';

// ─── Setup ───────────────────────────────────────────────────────────────────

const config = loadConfig();
const { url, auth } = config.assetManager;
console.log(`[dep-order] Connecting to: ${url}`);

const amClient = new AssetManagerClient({
  transport: 'http',
  url,
  auth: { type: 'basic', username: auth.username, password: auth.password },
});

// Ensure a clean slate. The asset is intentionally NOT created here —
// it represents the missing dependency (the "asset created" event that
// has not yet been processed).
console.log('[dep-order] Cleaning up any records from a previous run…');
try { await amClient.deletePool(DEMO_POOL);       } catch { /* not found */ }
try { await amClient.deleteAddress(DEMO_ADDRESS); } catch { /* not found */ }
try { await amClient.deleteAsset(DEMO_ASSET);     } catch { /* not found */ }

console.log('[dep-order] Creating address…');
await amClient.bulkUpsert({
  addresses: [{ address: DEMO_ADDRESS, contract: true, updateType: 'create_or_ignore' }],
});

// ─── Part A: retryOnInvalidRef: false ─────────────────────────────────────────
//
// A pool event arrives before the asset event. With retryOnInvalidRef: false
// the caller gets the KA090801 immediately and decides what to do (typically:
// the dependency is absent).

console.log('\n[dep-order] Part A — retryOnInvalidRef: false');

const builderA = new BulkUpsertBuilder(amClient, { retryOnInvalidRef: false });
builderA.upsertPool({
  name: DEMO_POOL,
  address: DEMO_ADDRESS,
  asset: DEMO_ASSET,
  standard: 'ERC20',
  updateType: 'create_or_replace',
});
builderA.addFinalizer(() => console.log('[dep-order] Part A finalizer ran (should not reach here).'));

try {
  await builderA.execute();
  console.log('[dep-order] Part A succeeded (unexpected).');
} catch (err) {
  if (err instanceof BulkUpsertInvalidRefError) {
    console.log('[dep-order] Part A: BulkUpsertInvalidRefError (unexpected — retry was disabled).');
  } else {
    const msg = amErrorMessage(err);
    if (msg.includes('KA090801')) {
      console.log(`[dep-order] Part A: KA090801 thrown immediately — ${msg}`);
      console.log('[dep-order] Finalizer did not run.');
    } else {
      throw err;
    }
  }
}

// ─── Part B: retryOnInvalidRef: true ─────────────────────────────────────────
//
// Same scenario with the default retry behaviour. The builder retries items
// individually in repeated passes. The asset is still absent so no pass can
// make progress; BulkUpsertInvalidRefError is thrown with the stuck items.

console.log('\n[dep-order] Part B — retryOnInvalidRef: true (default)');

const builderB = new BulkUpsertBuilder(amClient);
builderB.upsertPool({
  name: DEMO_POOL,
  address: DEMO_ADDRESS,
  asset: DEMO_ASSET,
  standard: 'ERC20',
  updateType: 'create_or_replace',
});
builderB.addFinalizer(() => console.log('[dep-order] Part B finalizer ran (should not reach here).'));

try {
  await builderB.execute();
  console.log('[dep-order] Part B succeeded (unexpected).');
} catch (err) {
  if (err instanceof BulkUpsertInvalidRefError) {
    const poolCount = err.stuck.pools?.length ?? 0;
    console.log(`[dep-order] Part B: BulkUpsertInvalidRefError — ${poolCount} pool(s) stuck after retry exhausted.`);
    console.log('[dep-order] Finalizer did not run.');
  } else {
    throw err;
  }
}

console.log('\n[dep-order] Done.');
