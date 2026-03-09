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
 * Component test configuration utilities
 * 
 * NOTE: This is TEST INFRASTRUCTURE, not SDK functionality.
 * This utility exists only for tests to load config from YAML files.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { WorkflowEngineConfig } from '../../src/config/config';

/**
 * TEST UTILITY: Load configuration from YAML file
 * 
 * This is test infrastructure only. The SDK itself does not load files.
 * 
 * Usage in tests:
 *   const config = loadTestConfig();
 *   const clientConfig = ConfigLoader.createClientConfig(config, 'my-provider');
 *   const client = new WorkflowEngineClient(clientConfig);
 */
export function loadTestConfig(): WorkflowEngineConfig {
  const configPath = path.join(__dirname, 'test-config.yaml');

  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configFile) as WorkflowEngineConfig;

    if (!config.workflowEngine) {
      throw new Error('Configuration missing workflowEngine section');
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to load test config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

