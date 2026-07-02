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
import type { IWSProxy } from '../http/ws_proxy_transport.js';
import { newLogger } from '../log/logger.js';

const KALEIDO_CONFIG_FILE = 'KALEIDO_CONFIG_FILE';
const WFE_CONFIG_FILE = 'WFE_CONFIG_FILE';

const log = newLogger('service-binding');

function cfgStr(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v.trim() : '';
}

function cfgNum(rec: Record<string, unknown>, key: string): number | undefined {
  const v = rec[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; }
  return undefined;
}

function cfgObj(rec: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = rec[key];
  return v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

/**
 * Configuration for a single service binding.
 *
 * - `bindingType: 'hosted'` — routes requests through the WebSocket proxy
 *   transport. The `id` identifies the service instance on the proxy side
 *   (which maps to the actual service URL). No `url` or `auth` needed.
 * - `bindingType: 'non-hosted'` (default) — direct HTTP transport using the
 *   provided `url` and optional `auth`.
 */
export type ServiceBindingConfig =
  | NonHostedServiceBindingConfig
  | HostedServiceBindingConfig;

export interface NonHostedServiceBindingConfig {
  /** Routing key identifying the target service type (e.g. 'asset-manager', 'key-manager', 'apigw') */
  type: string;
  bindingType: 'non-hosted';
  /** Base URL for direct HTTP. */
  url: string;
  /** Auth credentials for direct HTTP. */
  auth: ServiceBindingAuth;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface HostedServiceBindingConfig {
  /** Routing key identifying the target service type (e.g. 'asset-manager', 'key-manager', 'apigw') */
  type: string;
  bindingType: 'hosted';
  /** Service instance identifier. Sent to the proxy to resolve the actual service URL. */
  id: string;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Map of named service bindings parsed from config.
 * Keys are binding names (e.g. 'asset-manager'), values are their config.
 */
export type ServiceBindingsMap = Record<string, ServiceBindingConfig>;

/**
 * Resolve a parsed service binding to ServiceClientOptions.
 *
 * Non-hosted bindings resolve to a direct HTTP transport with no further
 * dependencies. Hosted bindings require a WebSocket proxy adapter (`wsProxy`),
 * which only the workflow-engine-sdk runtime can supply once connected — pass
 * the adapter obtained from `WorkflowEngineClient.getWSProxyAdapter()`.
 */
export function resolveServiceBindingFromMap(
  binding: ServiceBindingConfig,
  wsProxy?: IWSProxy,
): ServiceClientOptions {
  switch (binding.bindingType) {
    case 'hosted':
      if (!wsProxy) {
        throw new Error(
          `Service binding of type '${binding.type}' is a hosted binding and requires a ` +
            `live workflow-engine connection to resolve — supply a wsProxy adapter`,
        );
      }
      return {
        transport: 'ws-proxy',
        wsProxy,
        serviceType: binding.type,
        id: binding.id,
      };

    case 'non-hosted':
      return {
        transport: 'http',
        url: binding.url,
        auth: binding.auth,
        maxRetries: binding.maxRetries,
        timeout: binding.timeout,
      };

    default: {
      const _exhaustive: never = binding;
      throw new Error(
        `Service binding has unknown bindingType: ${(_exhaustive as ServiceBindingConfig).bindingType}`,
      );
    }
  }
}

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
      { cause: err },
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

function parseServiceBindingAuth(authObj: Record<string, unknown>): ServiceBindingAuth {
  const authType = cfgStr(authObj, 'type') || 'basic';
  const auth: ServiceBindingAuth = { type: authType as 'basic' | 'token' };
  if (authType === 'basic') {
    const username = cfgStr(authObj, 'username');
    const password = cfgStr(authObj, 'password');
    if (username) auth.username = username;
    if (password) auth.password = password;
  } else if (authType === 'token') {
    const token = cfgStr(authObj, 'token');
    const header = cfgStr(authObj, 'header');
    const scheme = cfgStr(authObj, 'scheme');
    if (token) auth.token = token;
    if (header) auth.header = header;
    if (scheme) auth.scheme = scheme;
  }
  return auth;
}

/**
 * Parse a plain object (already extracted from YAML) into a typed ServiceBindingsMap.
 * Invalid or incomplete entries are skipped with a warning.
 */
export function parseServiceBindingsSection(
  section: Record<string, unknown>,
): ServiceBindingsMap {
  const bindings: ServiceBindingsMap = {};
  for (const [name, value] of Object.entries(section)) {
    if (!value || typeof value !== 'object') {
      log.warn(`Skipping invalid service binding: ${name}`);
      continue;
    }
    const entry = value as Record<string, unknown>;
    const serviceType = cfgStr(entry, 'type') || name;
    const bindingType = cfgStr(entry, 'bindingType');
    const maxRetries = cfgNum(entry, 'maxRetries');
    const timeout = cfgNum(entry, 'timeout');

    if (bindingType === 'hosted') {
      const id = cfgStr(entry, 'id');
      if (!id) { log.warn(`Skipping hosted binding '${name}': missing required 'id' field`); continue; }
      bindings[name] = { type: serviceType, bindingType, id, maxRetries, timeout };
    } else {
      const url = cfgStr(entry, 'url');
      if (!url) { log.warn(`Skipping non-hosted binding '${name}': missing required 'url' field`); continue; }
      const authObj = cfgObj(entry, 'auth');
      if (!authObj) { log.warn(`Skipping non-hosted binding '${name}': missing required 'auth' field`); continue; }
      bindings[name] = {
        type: serviceType,
        bindingType: 'non-hosted',
        url,
        auth: parseServiceBindingAuth(authObj),
        maxRetries,
        timeout,
      };
    }
  }
  return bindings;
}

/**
 * Load and parse service bindings from the Kaleido config file.
 *
 * Reads `service-bindings` from the top level or nested under `workflow-engine`.
 * Returns an empty map (rather than throwing) when the file is absent or has no
 * bindings section — callers that require a specific binding should validate the result.
 */
export function loadServiceBindings(configFilePath?: string): ServiceBindingsMap {
  const configPath = (
    configFilePath ??
    process.env[KALEIDO_CONFIG_FILE] ??
    process.env[WFE_CONFIG_FILE] ??
    ''
  ).trim();
  if (!configPath) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return {};
  }

  const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== 'object') return {};

  const wfeSection = parsed['workflow-engine'] as Record<string, unknown> | undefined;
  const bindingsSection = (
    parsed['service-bindings'] ?? wfeSection?.['service-bindings']
  ) as Record<string, unknown> | undefined;
  if (!bindingsSection || typeof bindingsSection !== 'object') return {};

  return parseServiceBindingsSection(bindingsSection);
}
