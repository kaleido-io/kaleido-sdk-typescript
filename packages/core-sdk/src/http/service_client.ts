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

import { RequestConfigWithRetry } from "./http_client";
import { ServiceTransport } from "./transport";
import { HTTPTransport, HTTPTransportOptions } from "./http_base";
import {
  WSProxyTransport,
  WSProxyTransportOptions,
} from "./ws_proxy_transport";

export { ServiceTransport };

/**
 * Discriminated union of options for constructing a ServiceClient.
 *
 * The `transport` field selects which underlying transport implementation
 * is used. Provider code never constructs transports directly — it
 * obtains `ServiceClientOptions` from `client.getServiceClientOptions()`
 * and passes them to a typed client constructor.
 */
export type ServiceClientOptions =
  | ({ transport: "http" } & HTTPTransportOptions)
  | ({ transport: "ws-proxy" } & WSProxyTransportOptions);

/**
 * Create the appropriate ServiceTransport from a ServiceClientOptions union.
 */
export function createServiceTransport(
  options: ServiceClientOptions,
): ServiceTransport {
  switch (options.transport) {
    case "ws-proxy":
      return new WSProxyTransport(options);
    case "http":
    default:
      return new HTTPTransport(options);
  }
}

/**
 * Transport-agnostic base class for typed service clients.
 *
 * Typed clients (AssetManagerClient, etc.) extend this class and call the
 * protected get/post/put/patch/delete methods exactly as before. The
 * concrete transport is resolved at construction time from the
 * `ServiceClientOptions` discriminated union returned by
 * `client.getServiceClientOptions()`.
 *
 * ```typescript
 * class AssetManagerClient extends ServiceClient {
 *   async bulkUpsert(input: BulkUpsertInput): Promise<BulkUpsertResult> {
 *     return this.put('/api/v1/bulk/datamodel', input);
 *   }
 * }
 *
 * const amClient = new AssetManagerClient(
 *   client.getServiceClientOptions('asset-manager'),
 * );
 * ```
 */
export abstract class ServiceClient {
  private transport: ServiceTransport;

  constructor(transport: ServiceTransport) {
    this.transport = transport;
  }

  protected get<T>(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry & { ignore404?: boolean },
  ): Promise<T | undefined> {
    return this.transport.get<T>(url, params, config);
  }

  protected post<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    return this.transport.post<T>(url, data, config);
  }

  protected put<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    return this.transport.put<T>(url, data, config);
  }

  protected patch<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    return this.transport.patch<T>(url, data, config);
  }

  protected delete(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry,
  ): Promise<void> {
    return this.transport.delete(url, params, config);
  }
}
