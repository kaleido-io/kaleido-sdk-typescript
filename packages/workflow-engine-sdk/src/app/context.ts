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

import type { ServiceClientOptions } from '../service/index.js';

/**
 * Context injected into handler setup hooks and indexer process callbacks.
 * Provides access to per-handler config, provider identity, and service bindings.
 */
export interface SetupContext<CustomConfig = unknown> {
  readonly config: CustomConfig;
  readonly providerName: string;
  readonly handlerName: string;
  readonly signal: AbortSignal;
  /**
   * Resolve a named service binding from the WFE client config.
   * The returned options can be passed directly to a typed client constructor
   * such as AssetManagerClient.
   */
  getServiceClientOptions(bindingName: string): ServiceClientOptions;
}

/**
 * Context injected into indexer process callbacks. Extends SetupContext with
 * the request-scoped ID for the current batch.
 */
export interface IndexerContext<CustomConfig = unknown> extends SetupContext<CustomConfig> {
  readonly requestId: string;
}

export function createSetupContext<C>(
  getOptions: (name: string) => ServiceClientOptions,
  customConfig: C,
  providerName: string,
  handlerName: string,
  signal: AbortSignal,
): SetupContext<C> {
  return {
    config: customConfig,
    providerName,
    handlerName,
    signal,
    getServiceClientOptions: getOptions,
  };
}

export function createIndexerContext<C>(
  setupCtx: SetupContext<C>,
  requestId: string,
): IndexerContext<C> {
  return { ...setupCtx, requestId };
}
