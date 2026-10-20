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

import type { SetupContext } from '../context/index.js';
import { resolveServiceBinding } from '../config/service-binding.js';
import type { RequestConfigWithRetry } from './http_client.js';
import { ServiceClient, createServiceTransport, type ServiceClientOptions } from './service_client.js';

/**
 * A client for any service reached through a service binding, for services
 * that have no typed client. It sends requests to paths relative to the
 * service's base URL, adds the binding's credentials, parses JSON responses,
 * and throws on an error status.
 *
 * ```typescript
 * const registry = new GenericServiceClient(ctx, 'registry');
 * const namespaces = await registry.get<{ items: { name: string }[] }>('/api/v1/namespaces');
 * ```
 */
export class GenericServiceClient extends ServiceClient {
  /** Resolve the binding through a handler's context, as the caller of the work being handled. */
  constructor(ctx: Pick<SetupContext, 'getServiceClientOptions'>, bindingName: string);
  /** Use options already resolved, for example from `ctx.getServiceClientOptions(bindingName)`. */
  constructor(options: ServiceClientOptions);
  /** Resolve a binding from the Kaleido config file. Works only for non-hosted bindings. */
  constructor(bindingName: string);
  constructor(source: Pick<SetupContext, 'getServiceClientOptions'> | ServiceClientOptions | string, bindingName?: string) {
    super(createServiceTransport(GenericServiceClient.resolve(source, bindingName)));
  }

  private static resolve(
    source: Pick<SetupContext, 'getServiceClientOptions'> | ServiceClientOptions | string,
    bindingName?: string,
  ): ServiceClientOptions {
    if (typeof source === 'string') {
      return resolveServiceBinding(source);
    }
    if ('getServiceClientOptions' in source) {
      if (!bindingName) {
        throw new Error('GenericServiceClient needs a binding name when constructed from a context');
      }
      return source.getServiceClientOptions(bindingName);
    }
    return source;
  }

  /** GET a path. Returns undefined for a 404 when `config.ignore404` is set. */
  override get<T>(path: string, params?: unknown, config?: RequestConfigWithRetry & { ignore404?: boolean }): Promise<T | undefined> {
    return super.get<T>(path, params, config);
  }

  override post<T>(path: string, data?: unknown, config?: RequestConfigWithRetry): Promise<T> {
    return super.post<T>(path, data, config);
  }

  override put<T>(path: string, data?: unknown, config?: RequestConfigWithRetry): Promise<T> {
    return super.put<T>(path, data, config);
  }

  override patch<T>(path: string, data?: unknown, config?: RequestConfigWithRetry): Promise<T> {
    return super.patch<T>(path, data, config);
  }

  override delete(path: string, params?: unknown, config?: RequestConfigWithRetry): Promise<void> {
    return super.delete(path, params, config);
  }
}
