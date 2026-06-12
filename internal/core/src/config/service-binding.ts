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
import yaml from 'js-yaml';
import type { ServiceClientOptions } from '../http/service_client.js';
import type { ServiceBindingAuth } from '../http/types.js';

const KALEIDO_CONFIG_FILE = 'KALEIDO_CONFIG_FILE';
const WFE_CONFIG_FILE = 'WFE_CONFIG_FILE';

function resolveConfigPath(configFilePath?: string): string {
  return (
    configFilePath ??
    process.env[KALEIDO_CONFIG_FILE] ??
    process.env[WFE_CONFIG_FILE] ??
    './config/config.yaml'
  ).trim();
}

/**
 * Resolve a named service binding from the Kaleido config file to
 * ServiceClientOptions that can be passed directly to a typed client
 * constructor (e.g. AssetManagerClient).
 *
 * Only non-hosted (direct HTTP) bindings can be resolved this way.
 * Hosted bindings require a live WFE connection — pass a SetupContext instead.
 */
export function resolveServiceBinding(
  bindingName: string,
  configFilePath?: string,
): ServiceClientOptions {
  const configPath = resolveConfigPath(configFilePath);

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    throw new Error(
      `Cannot read config file '${configPath}': ${(err as Error).message}`,
    );
  }

  const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config file: ${configPath}`);
  }

  const wfeSection = parsed['workflow-engine'] as Record<string, unknown> | undefined;
  const bindingsSection = (
    parsed['service-bindings'] ?? wfeSection?.['service-bindings']
  ) as Record<string, unknown> | undefined;

  if (!bindingsSection || typeof bindingsSection !== 'object') {
    throw new Error(
      `No 'service-bindings' section found in config: ${configPath}`,
    );
  }

  const entry = bindingsSection[bindingName] as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== 'object') {
    throw new Error(
      `Service binding '${bindingName}' not found in '${configPath}'. ` +
      `Available: [${Object.keys(bindingsSection).join(', ')}]`,
    );
  }

  if (entry['bindingType'] === 'hosted') {
    throw new Error(
      `Service binding '${bindingName}' is a hosted binding and requires a ` +
      `live WFE connection to resolve — pass a SetupContext to the client constructor instead`,
    );
  }

  const url = entry['url'] as string | undefined;
  if (!url) {
    throw new Error(
      `Service binding '${bindingName}' is missing the required 'url' field`,
    );
  }

  const auth = entry['auth'] as ServiceBindingAuth | undefined;
  const maxRetries = entry['maxRetries'] as number | undefined;
  const timeout = entry['timeout'] as number | undefined;

  return {
    transport: 'http',
    url,
    ...(auth !== undefined && { auth }),
    ...(maxRetries !== undefined && { maxRetries }),
    ...(timeout !== undefined && { timeout }),
  };
}
