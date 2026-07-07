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

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface HandlerDefinition {
  name: string;
  file: string;
}

export interface HandlersConfig {
  transactionHandlers: HandlerDefinition[];
  eventSources: HandlerDefinition[];
  eventProcessors: HandlerDefinition[];
}

export const DEFAULT_PROVIDER_CONFIG_PATH = join(process.cwd(), 'config', 'provider-config.json');

export function resolveHandlersConfigPath(): string {
  const fromEnv = process.env.CONFIG_FILE?.trim();
  const candidates = [fromEnv, DEFAULT_PROVIDER_CONFIG_PATH].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  throw new Error(
    `Handlers config not found. Copy config/provider-config.sample.json to config/provider-config.json ` +
      `or set CONFIG_FILE to your JSON config path.`,
  );
}

function parseHandlerList(
  configPath: string,
  key: string,
  raw: unknown,
): HandlerDefinition[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Config at ${configPath} must define "${key}" as an array.`);
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${key}[${index}] must be an object with "name" and "file".`);
    }

    const { name, file } = entry as Partial<HandlerDefinition>;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`${key}[${index}].name must be a non-empty string.`);
    }
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new Error(`${key}[${index}].file must be a non-empty string.`);
    }

    return { name: name.trim(), file: file.trim() };
  });
}

export function listHandlerDefinitions(config: HandlersConfig): HandlerDefinition[] {
  return [...config.transactionHandlers, ...config.eventSources, ...config.eventProcessors];
}

export function loadHandlersConfig(configPath = resolveHandlersConfigPath()): HandlersConfig {
  const raw = readFileSync(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Config at ${configPath} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config at ${configPath} must be a JSON object.`);
  }

  const config = parsed as Record<string, unknown>;
  const transactionHandlers = parseHandlerList(
    configPath,
    'transactionHandlers',
    config.transactionHandlers,
  );
  const eventSources = parseHandlerList(configPath, 'eventSources', config.eventSources);
  const eventProcessors = parseHandlerList(configPath, 'eventProcessors', config.eventProcessors);

  const allHandlers = listHandlerDefinitions({
    transactionHandlers,
    eventSources,
    eventProcessors,
  });
  const duplicateNames = allHandlers
    .map((handler) => handler.name)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate handler names in config: ${[...new Set(duplicateNames)].join(', ')}`);
  }

  return { transactionHandlers, eventSources, eventProcessors };
}

/**
 * Resolves a handler file path from config.
 * Relative paths are resolved from the process working directory.
 * Absolute paths (as the platform may supply) are used as-is.
 */
export function resolveHandlerFilePath(_configPath: string, handlerFile: string): string {
  return resolve(handlerFile);
}
