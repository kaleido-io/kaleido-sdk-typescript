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

import { ServiceBindingAuth } from "@kaleido-io/core/http";
export { ServiceBindingAuth };

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
  bindingType: "non-hosted";
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
  bindingType: "hosted";
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
