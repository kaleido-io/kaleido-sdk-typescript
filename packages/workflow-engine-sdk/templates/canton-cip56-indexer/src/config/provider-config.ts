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

export interface CantonConfig {
  cantonConnector: string;
}

export interface ProviderConfig {
  assetManager: AssetManagerConfig;
  canton: CantonConfig;
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
  const account = typeof o.account === 'string' ? o.account : '';
  const environment = typeof o.environment === 'string' ? o.environment : '';
  const serviceName = typeof o.serviceName === 'string' ? o.serviceName : '';
  if (!account) throw new Error('provider config: assetManager.account is required');
  if (!environment) throw new Error('provider config: assetManager.environment is required');
  if (!serviceName) throw new Error('provider config: assetManager.serviceName is required');
  return { account, environment, serviceName, auth: parseAuth(o.auth) };
}

function parseCanton(raw: unknown): CantonConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider config: canton must be an object');
  }
  const o = raw as Record<string, unknown>;
  const cantonConnector = typeof o.cantonConnector === 'string' ? o.cantonConnector : '';
  if (!cantonConnector) {
    throw new Error('provider config: canton.cantonConnector is required');
  }
  return { cantonConnector };
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
  if (!parsed.canton) throw new Error('provider config: canton is required');
  return {
    assetManager: parseAssetManager(parsed.assetManager),
    canton: parseCanton(parsed.canton),
  };
}
