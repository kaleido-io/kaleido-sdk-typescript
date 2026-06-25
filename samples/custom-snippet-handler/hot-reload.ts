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

import { existsSync, watch, type FSWatcher } from 'fs';
import { dirname } from 'path';
import type { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';
import { loadHandlersConfig, resolveHandlerFilePath, resolveHandlersConfigPath } from './handlers-config.js';
import { createConfiguredClient } from './register-handlers.js';

const DEBOUNCE_MS = 300;

export function isHotReloadEnabled(): boolean {
  const flag = process.env.HOT_RELOAD?.trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'on') {
    return true;
  }
  if (flag === '0' || flag === 'false' || flag === 'off') {
    return false;
  }
  // Default on for tsx dev runs; off for compiled `node dist/connect.js`.
  return process.argv[1]?.endsWith('.ts') ?? false;
}

export interface HotReloadSession {
  getClient(): WorkflowEngineClient;
  stop(): void;
}

export async function startWithHotReload(): Promise<HotReloadSession> {
  let app = await createConfiguredClient();
  await app.start();
  logRegisteredHandlers('Started');

  let reloading = false;
  let reloadGeneration = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];

  async function reload(reason: string): Promise<void> {
    if (reloading) {
      return;
    }
    reloading = true;
    reloadGeneration += 1;

    try {
      console.log(`[hot-reload] Reloading (${reason})...`);
      app.stop();
      app = await createConfiguredClient({ cacheBust: String(reloadGeneration) });
      await app.start();
      logRegisteredHandlers('Reloaded');
    } catch (error) {
      console.error('[hot-reload] Reload failed:', error);
      try {
        app.stop();
        app = await createConfiguredClient({ cacheBust: String(reloadGeneration) });
        await app.start();
        logRegisteredHandlers('Recovered');
      } catch (retryError) {
        console.error('[hot-reload] Failed to restart after error:', retryError);
      }
    } finally {
      reloading = false;
    }
  }

  function scheduleReload(reason: string): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void reload(reason);
    }, DEBOUNCE_MS);
  }

  const configPath = resolveHandlersConfigPath();
  watchers.push(watch(configPath, () => scheduleReload('config changed')));

  const config = loadHandlersConfig(configPath);
  const watchedDirs = new Set<string>();
  for (const handler of config.handlers) {
    const handlerDir = dirname(resolveHandlerFilePath(configPath, handler.file));
    if (existsSync(handlerDir) && !watchedDirs.has(handlerDir)) {
      watchedDirs.add(handlerDir);
      watchers.push(
        watch(handlerDir, { recursive: true }, () => scheduleReload('handler file changed')),
      );
    }
  }

  return {
    getClient: () => app,
    stop: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      app.stop();
    },
  };
}

function logRegisteredHandlers(label: string): void {
  const config = loadHandlersConfig();
  const names = config.handlers.map((handler) => handler.name);
  console.log(
    `[hot-reload] ${label} with ${names.length} handler(s)` +
      (names.length > 0 ? `: ${names.join(', ')}` : ' (provider only)'),
  );
}
