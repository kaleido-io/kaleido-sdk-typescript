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

import type { WorkflowEngineClient, ServiceClientOptions } from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

/**
 * Context injected into handler setup hooks.
 */
export interface SetupContext<CustomConfig = unknown> {
  readonly config: CustomConfig;
  readonly providerName: string;
  readonly handlerName: string;
  readonly signal: AbortSignal;
  assetManagerClient(name?: string): AssetManagerClient;
  getServiceClientOptions(bindingName: string): ServiceClientOptions;
}

/**
 * Context injected into indexer process callbacks. Extends SetupContext with
 * request-scoped fields and the `am` convenience accessor.
 */
export interface IndexerContext<CustomConfig = unknown> extends SetupContext<CustomConfig> {
  readonly requestId: string;
  /** Shorthand for `assetManagerClient()` — throws if more than one AM binding is registered. */
  readonly am: AssetManagerClient;
}

export function createSetupContext<C>(
  wfeClient: WorkflowEngineClient,
  customConfig: C,
  providerName: string,
  handlerName: string,
  signal: AbortSignal,
): SetupContext<C> {
  const amCache = new Map<string, AssetManagerClient>();

  function getOrCreateAM(name: string): AssetManagerClient {
    if (!amCache.has(name)) {
      amCache.set(name, new AssetManagerClient(wfeClient.getServiceClientOptions(name)));
    }
    return amCache.get(name)!;
  }

  function assetManagerClient(name?: string): AssetManagerClient {
    if (name !== undefined) {
      return getOrCreateAM(name);
    }
    const bindings = wfeClient.getServiceBindings();
    const amNames = Object.entries(bindings)
      .filter(([, b]) => b.type === 'asset-manager')
      .map(([n]) => n);

    if (amNames.length === 0) {
      throw new Error('No asset-manager service bindings found in config');
    }
    if (amNames.length > 1) {
      throw new Error(
        `Multiple asset-manager service bindings found (${amNames.join(', ')}); specify a name`,
      );
    }
    return getOrCreateAM(amNames[0]!);
  }

  return {
    config: customConfig,
    providerName,
    handlerName,
    signal,
    assetManagerClient,
    getServiceClientOptions: (bindingName) => wfeClient.getServiceClientOptions(bindingName),
  };
}

export function createIndexerContext<C>(
  setupCtx: SetupContext<C>,
  requestId: string,
): IndexerContext<C> {
  let cachedAm: AssetManagerClient | undefined;
  return {
    ...setupCtx,
    requestId,
    get am(): AssetManagerClient {
      cachedAm ??= setupCtx.assetManagerClient();
      return cachedAm;
    },
  };
}
