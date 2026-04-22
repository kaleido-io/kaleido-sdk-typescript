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
 * WFE event stream definition for the BTC Transfer indexer.
 *
 * Connects two handlers:
 *   Source:    "btcTransactions" from the BTC Connector — polls for on-chain log
 *              events matching the Transfer(address,address,uint256) ABI.
 *   Processor: "bitcoin-indexer" from this provider — maps decoded Transfer events
 *              into Asset Manager bulk upserts.
 *
 * Deploy with: npm run create-stream
 *
 * Requires config/provider-config.yaml: btcConnector, bitcoin.contractAddress.
 */
const providerConfig = loadProviderConfig();

export const stream = {
  name: 'bitcoin-indexer',
  eventSource: {
    type: 'handler',
    handler: {
      name: 'btcTransactions',
      provider: providerConfig.btcConnector,
      config: {
        fromBlock: '0',
        batchSize: 50,
        pollTimeout: '30s',
        requiredConfirmations: 5
      }
    },
  },
  eventProcessor: {
    type: 'handler',
    handler: {
      name: 'bitcoin-indexer',
      provider: provider.name,
    },
  },
};
