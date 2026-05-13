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

import provider from '../provider.js';
import { loadProviderConfig } from '../config/provider-config.js';
import type { CantonContractEventsConfig } from './types.js';

const providerConfig = loadProviderConfig();

const eventSourceConfig: CantonContractEventsConfig = {
  fromOffset: 0,
  batchSize: 100,
  pollTimeout: '5s',
  parties: [],
  interfaceIds: [
    '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
  ],
  includeCreatedEventBlob: false,
};

/**
 * WFE event stream definition for the Canton CIP-56 indexer.
 *
 * Connects two handlers:
 *   Source:    "cantonContractEvents" from the Canton Connector — polls for
 *             contract lifecycle events matching CIP-56 interface IDs.
 *   Processor: "canton-cip56-indexer" from this provider — maps contract events
 *             into Asset Manager bulk upserts.
 *
 * Deploy with: npm run create-stream
 */
export const stream = {
  name: 'canton-cip56-indexer',
  eventSource: {
    type: 'handler',
    handler: {
      name: 'cantonContractEvents',
      provider: providerConfig.canton?.cantonConnector ?? '',
      config: eventSourceConfig,
    },
  },
  eventProcessor: {
    type: 'handler',
    handler: {
      name: 'canton-cip56-indexer',
      provider: provider.name,
    },
  },
};
