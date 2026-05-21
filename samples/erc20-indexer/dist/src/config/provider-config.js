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
function parseAuth(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('provider config: assetManager.auth must be an object');
    }
    const o = raw;
    const keyName = typeof o.keyName === 'string' ? o.keyName : '';
    const keyValue = typeof o.keyValue === 'string' ? o.keyValue : '';
    if (!keyName || !keyValue) {
        throw new Error('provider config: assetManager.auth.keyName and keyValue are required');
    }
    return { keyName, keyValue };
}
function parseAssetManager(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('provider config: assetManager must be an object');
    }
    const o = raw;
    return {
        account: typeof o.account === 'string' ? o.account : '',
        environment: typeof o.environment === 'string' ? o.environment : '',
        serviceName: typeof o.serviceName === 'string' ? o.serviceName : '',
        auth: parseAuth(o.auth),
    };
}
function parseERC20(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('provider config: erc20 must be an object');
    }
    const o = raw;
    return {
        contractAddress: typeof o.contractAddress === 'string' ? o.contractAddress : '',
        contractName: typeof o.contractName === 'string' ? o.contractName : 'ERC20',
        contractSymbol: typeof o.contractSymbol === 'string' ? o.contractSymbol : 'ERC20',
        chain: typeof o.chain === 'string' ? o.chain : 'ethereum',
    };
}
export function loadProviderConfig(configFilePath) {
    const pathToUse = (configFilePath ?? process.env[CONFIG_FILE] ?? DEFAULT_CONFIG_PATH).trim();
    const resolved = path.resolve(process.cwd(), pathToUse);
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Invalid provider config file: ${resolved}`);
    }
    if (!parsed.assetManager)
        throw new Error('provider config: assetManager is required');
    if (!parsed.erc20)
        throw new Error('provider config: erc20 is required');
    if (typeof parsed.evmConnector !== 'string' || !parsed.evmConnector) {
        throw new Error('provider config: evmConnector is required');
    }
    return {
        assetManager: parseAssetManager(parsed.assetManager),
        erc20: parseERC20(parsed.erc20),
        evmConnector: parsed.evmConnector,
    };
}
