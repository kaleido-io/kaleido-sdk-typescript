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
 * from the WFE config file, then PATCHes the runtime's image reference.
 *
 * Usage:
 *   RUNTIME_NAME=my-runtime IMAGE_REPOSITORY=samples/erc20-indexer npm run patch-provider-runtime
 */

import axios from 'axios';
import dotenv from 'dotenv';
import * as fs from 'fs';
import http from 'http';
import https from 'https';
import * as yaml from 'js-yaml';

dotenv.config();

const configPath = process.env.KALEIDO_CONFIG_FILE ?? process.env.WFE_CONFIG_FILE ?? './config/wfe-config.yaml';
const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
const section = raw['workflow-engine'] as Record<string, unknown> | undefined;
if (!section) {
  console.error(`Missing "workflow-engine" section in ${configPath}`);
  process.exit(1);
}

const wfeUrl = section['url'] as string | undefined;
if (!wfeUrl) {
  console.error(`Missing "url" in workflow-engine section of ${configPath}`);
  process.exit(1);
}

// WFE URL looks like: https://<account>.<tenant>/endpoint/<env>/<service>/rest
// The environment API base is everything up to and including the environment segment.
const endpointIdx = wfeUrl.indexOf('/endpoint/');
if (endpointIdx === -1) {
  console.error(`Cannot derive environment base URL from WFE url: ${wfeUrl}`);
  process.exit(1);
}
const afterEndpoint = wfeUrl.substring(endpointIdx + '/endpoint/'.length);
const envSegment = afterEndpoint.split('/')[0];
const baseURL = `${wfeUrl.substring(0, endpointIdx)}/api/v1/environments/${envSegment}`;

const auth = section['auth'] as { type?: string; username?: string; password?: string } | undefined;
if (!auth || auth.type !== 'basic' || !auth.username || !auth.password) {
  console.error(`Only basic auth is supported. Check "auth" in ${configPath}`);
  process.exit(1);
}
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
