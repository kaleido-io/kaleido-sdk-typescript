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
import * as path from 'path';
import yaml from 'js-yaml';

export const CONFIG_FILE = 'CONFIG_FILE';
const DEFAULT_CONFIG_PATH = './config/provider-config.yaml';

export interface AssetManagerAuth {
  keyName: string;
  keyValue: string;
}

export interface AssetManagerConfig {
  account: string;
  environment: string;
  serviceName: string;
  auth: AssetManagerAuth;
}

export interface BTCConfig {
  netId: number;
  tokenSymbol: string;
  tokenName: string;
  chain: string;
}

export interface ProviderConfig {
  assetManager: AssetManagerConfig;
  bitcoin: BTCConfig;
  /** Service ID of the BTC Connector provider, used when creating the event stream. */
  btcConnector: string;
}

function parseAuth(raw: unknown): AssetManagerAuth {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider config: assetManager.auth must be an object');
  }
  const o = raw as Record<string, unknown>;
  const keyName = typeof o.keyName === 'string' ? o.keyName : '';
  const keyValue = typeof o.keyValue === 'string' ? o.keyValue : '';
  if (!keyName || !keyValue) {
    throw new Error('provider config: assetManager.auth.keyName and keyValue are required');
  }
  return { keyName, keyValue };
}

function parseAssetManager(raw: unknown): AssetManagerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider config: assetManager must be an object');
  }
  const o = raw as Record<string, unknown>;
  return {
    account: typeof o.account === 'string' ? o.account : '',
    environment: typeof o.environment === 'string' ? o.environment : '',
    serviceName: typeof o.serviceName === 'string' ? o.serviceName : '',
    auth: parseAuth(o.auth),
  };
}

function parseBTC(raw: unknown): BTCConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider config: bitcoin must be an object');
  }
  const o = raw as Record<string, unknown>;
  return {
    netId: typeof o.netId === 'number' ? o.netId : 0x283f161c,
    tokenSymbol: typeof o.chain === 'string' ? o.chain : 'tBTC',
    tokenName: typeof o.chain === 'string' ? o.chain : 'test_bitcoin',
    chain: typeof o.chain === 'string' ? o.chain : 'testnet4',
  };
}

export function loadProviderConfig(configFilePath?: string): ProviderConfig {
  const pathToUse = (configFilePath ?? process.env[CONFIG_FILE] ?? DEFAULT_CONFIG_PATH).trim();
  const resolved = path.resolve(process.cwd(), pathToUse);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid provider config file: ${resolved}`);
  }
  if (!parsed.assetManager) throw new Error('provider config: assetManager is required');
  if (!parsed.bitcoin) throw new Error('provider config: bitcoin is required');
  if (typeof parsed.btcConnector !== 'string' || !parsed.btcConnector) {
    throw new Error('provider config: btcConnector is required');
  }
  return {
    assetManager: parseAssetManager(parsed.assetManager),
    bitcoin: parseBTC(parsed.bitcoin),
    btcConnector: parsed.btcConnector,
  };
}
