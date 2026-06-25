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
import yaml from 'js-yaml';

export interface HandlerDefinition {
  name: string;
  file: string;
}

export interface HandlersConfig {
  handlers: HandlerDefinition[];
}

const DEFAULT_CONFIG_PATH = join(process.cwd(), 'config', 'provider-config.yaml');

export function resolveHandlersConfigPath(): string {
  const fromEnv = process.env.CONFIG_FILE?.trim();
  const candidates = [
    fromEnv,
    DEFAULT_CONFIG_PATH,
    join(process.cwd(), 'config', 'provider-config.yaml'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  throw new Error(
    `Handlers config not found. Copy config/provider-config.sample.yaml to config/provider-config.yaml ` +
      `or set CONFIG_FILE to your YAML config path.`,
  );
}

export function loadHandlersConfig(configPath = resolveHandlersConfigPath()): HandlersConfig {
  const raw = readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw) as Partial<HandlersConfig> | null;

  if (!parsed?.handlers || !Array.isArray(parsed.handlers)) {
    throw new Error(`Config at ${configPath} must define a "handlers" array.`);
  }

  const handlers = parsed.handlers.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`handlers[${index}] must be an object with "name" and "file".`);
    }

    const { name, file } = entry as Partial<HandlerDefinition>;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`handlers[${index}].name must be a non-empty string.`);
    }
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new Error(`handlers[${index}].file must be a non-empty string.`);
    }

    return { name: name.trim(), file: file.trim() };
  });

  const duplicateNames = handlers
    .map((handler) => handler.name)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate handler names in config: ${[...new Set(duplicateNames)].join(', ')}`);
  }

  return { handlers };
}

/**
 * Resolves a handler file path from config.
 * Relative paths are resolved from the process working directory.
 * Absolute paths (as the platform may supply) are used as-is.
 */
export function resolveHandlerFilePath(_configPath: string, handlerFile: string): string {
  return resolve(handlerFile);
}
