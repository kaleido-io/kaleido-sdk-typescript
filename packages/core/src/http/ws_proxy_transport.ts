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

import { ServiceTransport } from "./transport";
import { RequestConfigWithRetry } from "./http_client";

/**
 * Minimal response shape returned by a WS proxy adapter.
 * Concrete implementations (e.g. WSProxyAdapter in workflow-engine-sdk)
 * return a superset of this — TypeScript structural typing ensures
 * compatibility without modification.
 */
export interface WSProxyResponse {
  status: number;
  bodyBase64?: string;
  error?: string;
}

/**
 * Minimal interface for a WebSocket proxy adapter.
 *
 * Implemented by WSProxyAdapter in workflow-engine-sdk. Defined here as an
 * interface so WSProxyTransport has no direct dependency on the WFE protocol.
 */
export interface IWSProxy {
  request(
    serviceType: string,
    method: string,
    id: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<WSProxyResponse>;
}

/**
 * Options for constructing a WSProxyTransport.
 */
export interface WSProxyTransportOptions {
  /** WS proxy adapter — provided by the workflow-engine-sdk runtime in hosted mode */
  wsProxy: IWSProxy;
  /** Service type routing key sent in each request (e.g. 'asset-manager') */
  serviceType: string;
  /** Service instance identifier for hosted bindings */
  id: string;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function decodeProxyResponse<T>(response: WSProxyResponse): T {
  if (response.bodyBase64) {
    return JSON.parse(
      Buffer.from(response.bodyBase64, "base64").toString("utf-8"),
    );
  }
  return undefined as unknown as T;
}

function throwOnError(response: WSProxyResponse): void {
  if (!isSuccess(response.status)) {
    throw new Error(
      `Service proxy returned ${response.status}: ${response.error || ""}`,
    );
  }
}

/**
 * WebSocket proxy transport.
 *
 * Serializes HTTP-style requests as service proxy messages, sends them
 * over the provider-proxy WebSocket connection, and decodes the response.
 * Used for platform-hosted provider mode where the proxy manages auth.
 */
export class WSProxyTransport implements ServiceTransport {
  private wsProxy: IWSProxy;
  private serviceType: string;
  private id: string;

  constructor(options: WSProxyTransportOptions) {
    this.wsProxy = options.wsProxy;
    this.serviceType = options.serviceType;
    this.id = options.id;
  }

  async get<T>(
    _url: string,
    _params?: any,
    config?: RequestConfigWithRetry & { ignore404?: boolean },
  ): Promise<T | undefined> {
    const response = await this.wsProxy.request(
      this.serviceType,
      "GET",
      this.id,
      undefined,
      undefined,
    );
    if (config?.ignore404 && response.status === 404) return undefined;
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async post<T>(_url: string, data: any): Promise<T> {
    const response = await this.wsProxy.request(
      this.serviceType,
      "POST",
      this.id,
      data,
      undefined,
    );
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async put<T>(_url: string, data: any): Promise<T> {
    const response = await this.wsProxy.request(
      this.serviceType,
      "PUT",
      this.id,
      data,
      undefined,
    );
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async patch<T>(_url: string, data: any): Promise<T> {
    const response = await this.wsProxy.request(
      this.serviceType,
      "PATCH",
      this.id,
      data,
      undefined,
    );
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async delete(_url: string): Promise<void> {
    const response = await this.wsProxy.request(
      this.serviceType,
      "DELETE",
      this.id,
      undefined,
    );
    throwOnError(response);
  }
}

/** @deprecated Use WSProxyTransport */
export const WSProxyServiceClient = WSProxyTransport;
