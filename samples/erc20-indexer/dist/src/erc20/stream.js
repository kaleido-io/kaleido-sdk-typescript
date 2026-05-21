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
import { loadProviderConfig } from '../config/provider-config.js';
import provider from '../provider.js';
/**
 * WFE event stream definition for the ERC20 Transfer indexer.
 *
 * Connects two handlers:
 *   Source:    "evmTransactions" from the EVM Connector — polls for on-chain log
 *              events matching the Transfer(address,address,uint256) ABI.
 *   Processor: "erc20-indexer" from this provider — maps decoded Transfer events
 *              into Asset Manager bulk upserts.
 *
 * Deploy with: npm run create-stream
 *
 * Requires config/provider-config.yaml: evmConnector, erc20.contractAddress.
 */
const providerConfig = loadProviderConfig();
// Kaleido platform service IDs are displayed as "s:xxxxx" but the WFE API only
// accepts alphanumerics, dots, dashes, and underscores for provider names.
// Strip the type-prefix (e.g. "s:") so users can paste the platform ID directly.
const evmConnectorProvider = providerConfig.evmConnector.replace(/^[a-z]+:/, '');
export const stream = {
    name: 'erc20-indexer',
    eventSource: {
        type: 'handler',
        handler: {
            name: 'evmTransactions',
            provider: evmConnectorProvider,
            config: {
                fromBlock: 'latest',
                batchSize: 50,
                pollTimeout: '30s',
                requiredConfirmations: 1,
                abi: [
                    {
                        type: 'event',
                        name: 'Transfer',
                        inputs: [
                            { name: 'from', type: 'address', indexed: true },
                            { name: 'to', type: 'address', indexed: true },
                            { name: 'value', type: 'uint256', indexed: false },
                        ],
                    },
                ],
                logFilters: [
                    {
                        addresses: [providerConfig.erc20.contractAddress],
                        eventSignatures: ['Transfer(address,address,uint256)'],
                    },
                ],
            },
        },
    },
    eventProcessor: {
        type: 'handler',
        handler: {
            name: 'erc20-indexer',
            provider: provider.name,
        },
    },
};
