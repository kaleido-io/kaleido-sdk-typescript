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

/**
 * Transport-agnostic interface for HTTP-style service communication.
 *
 * Implementations:
 * - `HTTPTransport`     — direct Axios calls (external/local provider mode)
 * - `WSProxyTransport`  — HTTP-over-WebSocket via provider-proxy (hosted mode)
 *
 * Consumers never implement this interface. It is used internally by
 * `ServiceClient` to delegate to the resolved transport.
 */
export interface ServiceTransport {
  get<T>(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry & { ignore404?: boolean },
  ): Promise<T | undefined>;

  post<T>(url: string, data: any, config?: RequestConfigWithRetry): Promise<T>;

  put<T>(url: string, data: any, config?: RequestConfigWithRetry): Promise<T>;

  patch<T>(url: string, data: any, config?: RequestConfigWithRetry): Promise<T>;

  delete(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry,
  ): Promise<void>;
}
