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

// Finding a handler of each kind in the exports of a loaded handler module, in
// any of the shapes snippets have used: a define* result under any name, or
// actionMap, eventSource, eventProcessorDef, processBatch or default.

import { newLogger } from '@kaleido-io/core-sdk/log';
import { isDefinedProcessor, isDefinedTransactionHandler } from '../handlers/define';
import type { EventProcessorDef } from '../app/types';
import type { ActionConfig, EventSource } from '../interfaces/handlers';
import type { WithStageDirector } from '../types/core';

const log = newLogger('snippet-package');

/**
 * A snippet can export its handler under any name. Used only when none of the
 * established export names (`actionMap`, `eventSource`, `eventProcessorDef`,
 * `processBatch`, `default`) is present, so a snippet that loads under those
 * names loads the same way.
 */
function soleNamedExport<T>(
  loaded: Record<string, unknown>,
  matches: (value: unknown) => value is T,
  description: string,
  handlerFile: string,
): T | undefined {
  const found: [string, T][] = [];
  for (const [name, value] of Object.entries(loaded)) {
    if (name !== 'default' && matches(value)) {
      found.push([name, value]);
    }
  }
  if (found.length > 1) {
    throw new Error(
      `${handlerFile} exports more than one ${description} (${found.map(([name]) => name).join(', ')}). ` +
        `Export one per file.`,
    );
  }
  return found[0]?.[1];
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

  const defined = soleNamedExport(
    loaded,
    isDefinedTransactionHandler,
    'transaction handler from defineTransactionHandler',
    handlerFile,
  );
  if (defined) {
    return defined;
  }

  const exportNames = Object.keys(loaded);
  throw new Error(
    `Transaction handler "${handlerName}" at ${handlerFile} must export a handler from defineTransactionHandler ` +
      `or an "actionMap" Map ` +
      `(loaded from ${importPath}; exports: ${exportNames.length > 0 ? exportNames.join(', ') : 'none'}).`,
  );
}

function resolveHandlerName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const name = (value as { name?: unknown }).name;
  if (typeof name === 'string') {
    return name;
  }
  if (typeof name === 'function') {
    return (name as (this: unknown) => string).call(value);
  }
  return undefined;
}

function isEventSource(value: unknown): value is EventSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as EventSource).eventSourcePoll === 'function'
  );
}

/**
 * Wrap an event source so `.name` reports the configured handler name, without
 * mutating the loaded module's object (whose `name` may be a getter or method).
 */
function renameEventSource(source: EventSource, name: string): EventSource {
  return new Proxy(source, {
    get(target, prop) {
      if (prop === 'name') {
        return name;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function nameEventSource(source: EventSource, handlerName: string, handlerFile: string): EventSource {
  const sourceName = resolveHandlerName(source);
  if (sourceName !== undefined && sourceName !== handlerName) {
    // The config name is authoritative (it is what the platform routes on,
    // and how transaction handlers / event processors are registered), so a
    // snippet can be reused under any handler name regardless of the name
    // it exports.
    log.warn(
      `Event source "${handlerName}" at ${handlerFile} exports eventSource.name "${sourceName}"; ` +
        `registering it under the configured name "${handlerName}".`,
    );
    return renameEventSource(source, handlerName);
  }
  return source;
}

export function extractEventSource(
  loaded: Record<string, unknown>,
  handlerName: string,
  handlerFile: string,
  importPath: string,
): EventSource {
  const defaultExport = loaded.default;
  const fromDefault =
    defaultExport &&
    typeof defaultExport === 'object' &&
    !Array.isArray(defaultExport) &&
    'eventSource' in defaultExport
      ? (defaultExport as { eventSource: unknown }).eventSource
      : undefined;

  for (const candidate of [loaded.eventSource, fromDefault, defaultExport]) {
    if (isEventSource(candidate)) {
      return nameEventSource(candidate, handlerName, handlerFile);
    }
  }

  const namedSource = soleNamedExport(loaded, isEventSource, 'event source', handlerFile);
  if (namedSource) {
    return nameEventSource(namedSource, handlerName, handlerFile);
  }

  const exportNames = Object.keys(loaded);
  throw new Error(
    `Event source "${handlerName}" at ${handlerFile} must export an event source ` +
      `(loaded from ${importPath}; exports: ${exportNames.length > 0 ? exportNames.join(', ') : 'none'}).`,
  );
}

function isProcessBatchFn(value: unknown): value is EventProcessorDef['processBatch'] {
  return typeof value === 'function';
}

// defineProcessor returns a function that is also a definition, so a
// definition may be a function as well as an object.
function isEventProcessorDef(value: unknown): value is EventProcessorDef {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as EventProcessorDef).processBatch === 'function'
  );
}

export function extractEventProcessorDef(
  loaded: Record<string, unknown>,
  handlerName: string,
  handlerFile: string,
  importPath: string,
): EventProcessorDef {
  const defaultExport = loaded.default;
  const fromDefault =
    defaultExport &&
    typeof defaultExport === 'object' &&
    !Array.isArray(defaultExport)
      ? (defaultExport as Record<string, unknown>)
      : undefined;

  for (const candidate of [loaded.eventProcessorDef, fromDefault, defaultExport]) {
    if (isEventProcessorDef(candidate)) {
      return candidate;
    }
  }

  const fromNamed =
    defaultExport &&
    typeof defaultExport === 'object' &&
    !Array.isArray(defaultExport) &&
    'processBatch' in defaultExport
      ? (defaultExport as { processBatch: unknown }).processBatch
      : undefined;

  for (const candidate of [loaded.processBatch, fromNamed]) {
    if (isProcessBatchFn(candidate)) {
      return { processBatch: candidate };
    }
  }

  if (isProcessBatchFn(defaultExport)) {
    return { processBatch: defaultExport };
  }

  const defined = soleNamedExport(loaded, isDefinedProcessor, 'event processor from defineProcessor', handlerFile);
  if (defined) {
    return { processBatch: defined.processBatch };
  }

  const exportNames = Object.keys(loaded);
  throw new Error(
    `Event processor "${handlerName}" at ${handlerFile} must export a processor from defineProcessor, ` +
      `a "processBatch" function ` +
      `or an event processor def with processBatch ` +
      `(loaded from ${importPath}; exports: ${exportNames.length > 0 ? exportNames.join(', ') : 'none'}).`,
  );
}

