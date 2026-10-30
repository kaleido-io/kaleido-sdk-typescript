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
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { newLogger } from '@kaleido-io/core-sdk/log';
import { WorkflowEngineClient, type HandlerRegistrationOptions } from '../client/client';
import { CONFIG_FILE } from '../config/config';
import { createTransactionHandler } from '../factories/transaction_handler';
import type { EventProcessorDef } from '../app/types';
import type { ActionConfig, EventSource } from '../interfaces/handlers';
import type { WithStageDirector } from '../types/core';
import { extractActionMap, extractEventProcessorDef, extractEventSource } from './extract';
import { packageImportCheck, resolvePackageEntry } from './imports';
import { bundleHandler, evaluateHandlerBundle, type BundleHandlerOptions } from './load';
import { DEFAULT_PACKAGE_CONFIG_FILE, HANDLER_KINDS, isSuppliedDependency, snippetPackageContents, type HandlerKind, type SnippetPackageJson, type SnippetPackageManifest } from './package';
import type { DiscoverOptions } from './discover';

const log = newLogger('snippet-package');

/** A handler of a snippet package to load: its kind, the name it registers under, and its source file. */
export interface PackageHandlerToLoad {
  kind: HandlerKind;
  name: string;
  entry: string;
}

/** A handler loaded from a snippet package, ready to register. */
export type LoadedPackageHandler = PackageHandlerToLoad &
  (
    | { kind: 'transactionHandlers'; actionMap: Map<string, ActionConfig<WithStageDirector>> }
    | { kind: 'eventSources'; source: EventSource }
    | { kind: 'eventProcessors'; def: EventProcessorDef }
  );

export interface LoadPackageHandlersOptions extends Omit<BundleHandlerOptions, 'importCheck' | 'workingDir'> {
  /** The package's name, for messages. */
  packageName: string;
  /** The packages the handlers may import, besides their own files and Node.js built-ins. */
  supplied: string[];
  /** Makes a reload evaluate each handler afresh. */
  cacheBust?: string;
}

/**
 * Load handlers from a snippet package directory, the same way wherever the
 * package runs: each handler is bundled on its own from its entry file, its
 * imports are checked against the supplied packages, and the handler is found
 * in the module's exports.
 */
export async function loadPackageHandlers(
  packageDir: string,
  handlers: PackageHandlerToLoad[],
  options: LoadPackageHandlersOptions,
): Promise<LoadedPackageHandler[]> {
  const { packageName, supplied, cacheBust, ...bundleOptions } = options;
  const loaded: LoadedPackageHandler[] = [];
  for (const handler of handlers) {
    const entryPath = resolvePackageEntry(handler, packageDir, packageName);
    const importCheck = packageImportCheck(`${handler.entry} in package ${packageName}`, packageDir, supplied);
    const code = await bundleHandler(entryPath, { ...bundleOptions, importCheck, workingDir: packageDir });
    const exports = await evaluateHandlerBundle(code, cacheBust);
    const where = `${handler.entry} in package ${packageName}`;
    switch (handler.kind) {
      case 'transactionHandlers':
        loaded.push({ ...handler, kind: handler.kind, actionMap: extractActionMap(exports, handler.name, where, entryPath) });
        break;
      case 'eventSources':
        loaded.push({ ...handler, kind: handler.kind, source: extractEventSource(exports, handler.name, where, entryPath) });
        break;
      case 'eventProcessors':
        loaded.push({ ...handler, kind: handler.kind, def: extractEventProcessorDef(exports, handler.name, where, entryPath) });
        break;
    }
  }
  return loaded;
}

/** Register loaded handlers with a client, each with the options `optionsFor` gives it. */
export function registerPackageHandlers<C>(
  client: WorkflowEngineClient<C>,
  handlers: LoadedPackageHandler[],
  optionsFor: (handler: LoadedPackageHandler) => HandlerRegistrationOptions | undefined = () => undefined,
): WorkflowEngineClient<C> {
  for (const handler of handlers) {
    const options = optionsFor(handler);
    switch (handler.kind) {
      case 'transactionHandlers':
        client.transactionHandler(handler.name, { handler: createTransactionHandler(handler.name, handler.actionMap) }, options);
        break;
      case 'eventSources':
        client.eventSource(handler.source, options);
        break;
      case 'eventProcessors':
        client.eventProcessor(handler.name, handler.def, options);
        break;
    }
  }
  return client;
}

/** Read a handler config file: YAML, of which JSON is a part. */
export function readHandlerConfigFile(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Config file ${path} can't be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file ${path} must hold an object.`);
  }
  return parsed as Record<string, unknown>;
}

export interface RunSnippetPackageOptions {
  /** The Kaleido config file: how to reach the workflow engine. Defaults to `KALEIDO_CONFIG_FILE`. */
  kaleidoConfigFile?: string;
  /** Overrides the package's default config file. Defaults to `CONFIG_FILE`, when it is set. */
  configFile?: string;
  /** The TypeScript compiler module, which finds handlers in the source more reliably. */
  typescript?: DiscoverOptions['typescript'];
}

/** A snippet package's handlers, found the way `ksdk package` finds them, with the config each one gets. */
export interface SnippetPackagePlan {
  packageName: string;
  handlers: PackageHandlerToLoad[];
  /** The packages its handlers may import. */
  supplied: string[];
  /** The file every handler's config comes from unless the handler has its own, if any. */
  defaultConfigFile?: string;
  /** The config file of each handler that has its own, by name. */
  handlerConfigFiles: Record<string, string>;
  /** The secrets each handler reads, by name; a handler not listed reads none. */
  handlerSecretNames: Record<string, string[]>;
}

/**
 * Work out what running a snippet package directory involves: its handlers, as
 * listed in package.json or found in the code, and the config files they read.
 */
export function planSnippetPackage(packageDir: string, options: RunSnippetPackageOptions = {}): SnippetPackagePlan {
  const dir = resolve(packageDir);
  const packed = snippetPackageContents(dir, { typescript: options.typescript });
  if (packed.problems.length > 0) {
    throw new Error(`The handlers in ${dir} can't be listed:\n${packed.problems.join('\n')}`);
  }
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as SnippetPackageJson;
  const manifest: SnippetPackageManifest = packed.handlers;
  const handlers = HANDLER_KINDS.flatMap((kind) => (manifest[kind] ?? []).map((h) => ({ kind, name: h.name, entry: h.entry })));
  const handlerConfigFiles: Record<string, string> = {};
  const handlerSecretNames: Record<string, string[]> = {};
  for (const kind of HANDLER_KINDS) {
    for (const h of manifest[kind] ?? []) {
      if (h.config) {
        handlerConfigFiles[h.name] = resolve(dir, h.config);
      }
      if (h.secrets && h.secrets.length > 0) {
        handlerSecretNames[h.name] = h.secrets;
      }
    }
  }
  const nominated = options.configFile || process.env[CONFIG_FILE]?.trim() || manifest.config;
  let defaultConfigFile: string | undefined;
  if (nominated) {
    defaultConfigFile = resolve(dir, nominated);
  } else if (existsSync(resolve(dir, DEFAULT_PACKAGE_CONFIG_FILE))) {
    defaultConfigFile = resolve(dir, DEFAULT_PACKAGE_CONFIG_FILE);
  }
  const supplied = Object.keys(pkg.dependencies ?? {}).filter(isSuppliedDependency);
  return { packageName: pkg.name ?? dir, handlers, supplied, defaultConfigFile, handlerConfigFiles, handlerSecretNames };
}

/**
 * Run a snippet package's handlers in this process, as a TypeScript provider
 * would run them: found the same way, bundled and checked the same way, and
 * each given its config. The package's default config file is every handler's
 * `ctx.config` unless the handler names its own. Returns the started client;
 * call `stop()` on it to shut down.
 */
export async function runSnippetPackage(packageDir: string, options: RunSnippetPackageOptions = {}): Promise<WorkflowEngineClient> {
  const dir = resolve(packageDir);
  const plan = planSnippetPackage(dir, options);
  if (plan.handlers.length === 0) {
    throw new Error(`${dir} has no handlers: define them with defineTransactionHandler, defineEventSource or defineProcessor.`);
  }
  const defaultConfig = plan.defaultConfigFile ? readHandlerConfigFile(plan.defaultConfigFile) : {};
  const handlerConfigs = Object.fromEntries(Object.entries(plan.handlerConfigFiles).map(([name, file]) => [name, readHandlerConfigFile(file)]));

  const loaded = await loadPackageHandlers(dir, plan.handlers, { packageName: plan.packageName, supplied: plan.supplied });
  const client = WorkflowEngineClient.fromConfigFile(options.kaleidoConfigFile, { customConfig: defaultConfig as unknown });
  // As in a TypeScript provider, a handler sees only the secrets it reads: those its package lists for it
  registerPackageHandlers(client, loaded, (h) => ({
    ...(handlerConfigs[h.name] ? { config: handlerConfigs[h.name] } : {}),
    secretNames: plan.handlerSecretNames[h.name] ?? [],
  }));
  for (const h of loaded) {
    const configFrom = plan.handlerConfigFiles[h.name] ?? plan.defaultConfigFile ?? 'none';
    const secrets = plan.handlerSecretNames[h.name]?.join(', ') || 'none';
    log.info(`Loaded ${h.kind === 'transactionHandlers' ? 'transaction handler' : h.kind === 'eventSources' ? 'event source' : 'event processor'} ${h.name} from ${h.entry}, config: ${configFrom}, secrets: ${secrets}`);
  }
  await client.start();
  return client;
}
