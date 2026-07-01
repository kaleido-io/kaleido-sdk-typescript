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
import { newLogger } from "../log/logger";

const log = newLogger("ws_proxy_transport");

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
    path?: string,
    authRef?: string,
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
  /** Auth reference forwarded from WSEvaluateTransaction.authRef so the proxy can attach the cached bearer token. */
  authRef?: string;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Append query parameters to a URL.
 *
 * The HTTP transport forwards `params` to Axios, which serializes them onto the
 * query string. The proxy transport has no Axios layer, so it must do the same
 * here — otherwise list filters are silently dropped over the proxy. Arrays are
 * serialized as repeated keys (`?k=a&k=b`), matching the Kaleido query convention;
 * null/undefined values are skipped.
 */
function appendQueryParams(url: string, params?: any): string {
  if (params === undefined || params === null) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null) search.append(key, String(v));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
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
  private authRef?: string;

  constructor(options: WSProxyTransportOptions) {
    this.wsProxy = options.wsProxy;
    this.serviceType = options.serviceType;
    this.id = options.id;
    this.authRef = options.authRef;
  }

  private async proxyRequest(method: string, url: string, body?: any): Promise<WSProxyResponse> {
    log.debug(`-> ws-proxy ${method} ${this.serviceType}/${this.id}${url} authRef=${this.authRef ? this.authRef.substring(0, 8) + '...' : '(none)'}`);
    const headers = body !== undefined ? { 'Content-Type': 'application/json' } : undefined;
    const response = await this.wsProxy.request(
      this.serviceType,
      method,
      this.id,
      body,
      headers,
      url,
      this.authRef,
    );
    log.debug(`<- ws-proxy ${method} ${this.serviceType}/${this.id}${url} status=${response.status}${response.error ? ` error=${response.error}` : ''}`);
    return response;
  }

  async get<T>(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry & { ignore404?: boolean },
  ): Promise<T | undefined> {
    const response = await this.proxyRequest("GET", appendQueryParams(url, params));
    if (config?.ignore404 && response.status === 404) return undefined;
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async post<T>(url: string, data: any): Promise<T> {
    const response = await this.proxyRequest("POST", url, data);
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async put<T>(url: string, data: any): Promise<T> {
    const response = await this.proxyRequest("PUT", url, data);
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async patch<T>(url: string, data: any): Promise<T> {
    const response = await this.proxyRequest("PATCH", url, data);
    throwOnError(response);
    return decodeProxyResponse<T>(response);
  }

  async delete(url: string, params?: any): Promise<void> {
    const response = await this.proxyRequest("DELETE", appendQueryParams(url, params));
    throwOnError(response);
  }
}

/** @deprecated Use WSProxyTransport */
export const WSProxyServiceClient = WSProxyTransport;
