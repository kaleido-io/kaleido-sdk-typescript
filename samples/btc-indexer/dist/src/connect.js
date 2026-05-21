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
import { NewWorkflowEngineClient, HandlerSetFor } from '@kaleido-io/workflow-engine-sdk';
import dotenv from 'dotenv';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import { loadProviderConfig } from './config/provider-config.js';
import { bitcoinIndexer } from './bitcoin/indexer.js';
dotenv.config();
const providerConfig = loadProviderConfig();
const am = providerConfig.assetManager;
const amUrl = `https://${am.account}/endpoint/${am.environment}/${am.serviceName}/rest`;
const amClient = new AssetManagerClient({
    transport: 'http',
    url: amUrl,
    auth: { type: 'basic', username: am.auth.keyName, password: am.auth.keyValue },
});
await bitcoinIndexer.setup(amClient, providerConfig.bitcoin);
const client = await NewWorkflowEngineClient(HandlerSetFor(bitcoinIndexer.handler), process.env.WFE_CONFIG_FILE ?? './config/wfe-config.yaml');
process.on('SIGINT', () => client.disconnect());
process.on('SIGTERM', () => client.disconnect());
