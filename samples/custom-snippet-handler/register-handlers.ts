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

import { existsSync } from 'fs';
import { builtinModules } from 'module';
import { relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import * as esbuild from 'esbuild';
import {
  WorkflowEngineClient,
  createTransactionHandler,
  type ActionConfig,
  type WithStageDirector,
} from '@kaleido-io/workflow-engine-sdk';
import {
  type HandlerDefinition,
  type HandlersConfig,
  loadHandlersConfig,
  resolveHandlerFilePath,
  resolveHandlersConfigPath,
} from './handlers-config.js';

export interface HandlerModule {
  actionMap: Map<string, ActionConfig<WithStageDirector>>;
}

function isRunningCompiled(): boolean {
  return process.argv[1]?.includes('/dist/') ?? false;
}

/** True when the handler file is mounted outside the provider working directory. */
export function isMountedHandlerPath(importPath: string): boolean {
  const rel = relative(process.cwd(), resolve(importPath));
  return rel.startsWith('..');
}

const nodeBuiltinExternals = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

function providerNodeModulePaths(): string[] {
  const paths: string[] = [];
  let dir = process.cwd();
  const root = resolve(dir, '/');
  while (dir !== root) {
    paths.push(resolve(dir, 'node_modules'));
    dir = resolve(dir, '..');
  }
  return paths;
}

async function loadHandlerModule(
  importPath: string,
  cacheBust?: string,
): Promise<Record<string, unknown>> {
  if (!isMountedHandlerPath(importPath)) {
    let moduleUrl = pathToFileURL(importPath).href;
    if (cacheBust) {
      moduleUrl += `?reload=${encodeURIComponent(cacheBust)}`;
    }
    return (await import(moduleUrl)) as Record<string, unknown>;
  }

  let result: esbuild.BuildResult;
  try {
    result = await esbuild.build({
      entryPoints: [importPath],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      absWorkingDir: process.cwd(),
      nodePaths: providerNodeModulePaths(),
      packages: 'bundle',
      external: nodeBuiltinExternals,
      logLevel: 'silent',
    });
  } catch (error) {
    throw new Error(
      `Failed to bundle mounted handler at ${importPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const outputFile = result.outputFiles?.[0];
  const bundled = outputFile?.text;
  if (!bundled) {
    throw new Error(`Failed to bundle mounted handler at ${importPath}: esbuild produced no output`);
  }

  // esbuild's CJS interop emits __require() calls that throw in ESM data-URL modules.
  // Anchor createRequire to this provider file (a real file:// URL), not the data URL.
  const code =
    `import { createRequire } from 'module';\n` +
    `const require = createRequire(${JSON.stringify(import.meta.url)});\n` +
    bundled;

  const url =
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}` +
    (cacheBust ? `#${encodeURIComponent(cacheBust)}` : '');

  return (await import(url)) as Record<string, unknown>;
}

export function handlerPathCandidates(configPath: string, handlerFile: string): string[] {
  const sourcePath = resolveHandlerFilePath(configPath, handlerFile);
  const candidates: string[] = [];

  const add = (path: string): void => {
    if (!candidates.includes(path)) {
      candidates.push(path);
    }
  };

  const jsPath = sourcePath.endsWith('.ts')
    ? sourcePath.replace(/\.ts$/, '.js')
    : sourcePath.endsWith('.js')
      ? sourcePath
      : undefined;
  const tsPath = sourcePath.endsWith('.ts') ? sourcePath : undefined;

  if (isRunningCompiled()) {
    // Prefer the extension named in config, then fall back to the other.
    if (tsPath) {
      add(tsPath);
      if (jsPath) {
        add(jsPath);
      }
      const rel = relative(process.cwd(), tsPath);
      if (!rel.startsWith('..')) {
        add(resolve(process.cwd(), 'dist', rel.replace(/\.ts$/, '.js')));
      }
    } else if (jsPath) {
      add(jsPath);
    } else {
      add(sourcePath);
    }
  } else {
    add(sourcePath);
    if (jsPath && jsPath !== sourcePath) {
      add(jsPath);
    }
  }

  return candidates;
}

export function resolveImportPath(configPath: string, handlerFile: string): string {
  const candidates = handlerPathCandidates(configPath, handlerFile);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Handler file not found: ${candidates[0]} (tried: ${candidates.join(', ')}). ` +
      `Ensure the file exists at the path given in provider-config.yaml — ` +
      `the platform may mount snippet implementations at any absolute path.`,
  );
}

export interface RegisterHandlersOptions {
  cacheBust?: string;
}

function toActionMap(value: unknown): Map<string, ActionConfig<WithStageDirector>> | undefined {
  if (value instanceof Map) {
    return value as Map<string, ActionConfig<WithStageDirector>>;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }

  return new Map(entries) as Map<string, ActionConfig<WithStageDirector>>;
}

export function extractActionMap(
  loaded: Record<string, unknown>,
  handlerName: string,
  handlerFile: string,
  importPath: string,
): Map<string, ActionConfig<WithStageDirector>> {
  const defaultExport = loaded.default;
  const fromDefault =
    defaultExport &&
    typeof defaultExport === 'object' &&
    !Array.isArray(defaultExport) &&
    'actionMap' in defaultExport
      ? (defaultExport as { actionMap: unknown }).actionMap
      : undefined;

  for (const candidate of [loaded.actionMap, fromDefault, defaultExport]) {
    const map = toActionMap(candidate);
    if (map) {
      return map;
    }
  }

  const exportNames = Object.keys(loaded);
  throw new Error(
    `Handler "${handlerName}" at ${handlerFile} must export an "actionMap" Map ` +
      `(loaded from ${importPath}; exports: ${exportNames.length > 0 ? exportNames.join(', ') : 'none'}).`,
  );
}

export async function importHandlerModule(
  configPath: string,
  handler: HandlerDefinition,
  options?: RegisterHandlersOptions,
): Promise<HandlerModule> {
  const importPath = resolveImportPath(configPath, handler.file);
  const loaded = await loadHandlerModule(importPath, options?.cacheBust);

  return { actionMap: extractActionMap(loaded, handler.name, handler.file, importPath) };
}

export async function registerHandlersFromConfig(
  client: WorkflowEngineClient,
  config: HandlersConfig,
  configPath: string,
  options?: RegisterHandlersOptions,
): Promise<WorkflowEngineClient> {
  let registered = client;

  for (const handler of config.handlers) {
    const { actionMap } = await importHandlerModule(configPath, handler, options);
    registered = registered.transactionHandler(handler.name, {
      handler: createTransactionHandler(handler.name, actionMap),
    });
  }

  return registered;
}

export async function createConfiguredClient(
  options?: RegisterHandlersOptions,
): Promise<WorkflowEngineClient> {
  const configPath = resolveHandlersConfigPath();
  const config = loadHandlersConfig(configPath);
  return registerHandlersFromConfig(WorkflowEngineClient.fromConfigFile(), config, configPath, options);
}
