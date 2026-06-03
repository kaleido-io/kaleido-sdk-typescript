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
 * Utility script: patch the ProviderRuntime image in the Kaleido platform.
 *
 * Derives the environment-level REST API base URL and auth credentials
 * from the indexer config file, then PATCHes the runtime's image reference.
 *
 * Usage:
 *   RUNTIME_NAME=my-runtime IMAGE_REPOSITORY=samples/erc20-indexer npm run patch-provider-runtime
 */

import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';
import { IndexerConfig } from '@kaleido-io/sdk';

dotenv.config();

const config = IndexerConfig.loadFromFile();

const platformUrl = config.platform?.url?.replace(/\/+$/, '');
if (!platformUrl) {
  console.error('Missing platform.url in config');
  process.exit(1);
}

const envId = config.environmentNameOrId;
if (!envId) {
  console.error('Missing environmentNameOrId in config');
  process.exit(1);
}

const auth = config.platform?.auth;
if (!auth?.username || !auth?.password) {
  console.error('Missing platform.auth.username / password in config');
  process.exit(1);
}

const baseURL = `${platformUrl}/api/v1/environments/${envId}`;
const authHeader = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;

const runtimeName = process.env.RUNTIME_NAME ?? 'erc20-indexer-runtime';
const runtimeImageRepository = process.env.IMAGE_REPOSITORY ?? 'samples/erc20-indexer';
const runtimeImageTag = process.env.IMAGE_TAG ?? 'v1';

const restClient = axios.create({
  baseURL,
  timeout: 30_000,
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
  headers: { Authorization: authHeader },
});

console.log(`PATCHing runtime "${runtimeName}" at ${baseURL}/runtimes/${runtimeName}`);

const response = await restClient.put(`/runtimes/${runtimeName}`, {
  name: runtimeName,
  type: 'ProviderRuntime',
  image: {
    repository: runtimeImageRepository,
    tag: runtimeImageTag,
  },
});

if (response.status >= 300) {
  console.error(`Failed to patch provider runtime ${runtimeName}: ${response.status} ${response.statusText}`);
  process.exit(1);
}

console.log(`Runtime "${runtimeName}" updated successfully (${response.status})`);
