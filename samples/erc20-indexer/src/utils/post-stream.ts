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
 * Utility script: create the ERC-20 event stream in the Workflow Engine.
 *
 * Run once after deploying your provider:
 *   npm run create-stream
 */

import { WorkflowEngineRestClient } from '@kaleido-io/workflow-engine-sdk';
import { ConfigLoader } from '@kaleido-io/workflow-engine-sdk';
import dotenv from 'dotenv';
import { stream } from '../erc20/stream.js';

dotenv.config();

const config = ConfigLoader.loadClientConfigFromFile(
  process.env.WFE_CONFIG_FILE ?? './config/wfe-config.yaml',
);

const restClient = new WorkflowEngineRestClient(config);
const result = await restClient.createStream(stream);
console.log('Stream created:', JSON.stringify(result, null, 2));
