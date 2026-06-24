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

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { ServiceBindingAuth } from "./types";
import { Logger } from "../log/logger";
import { configureHttpClient, RequestConfigWithRetry } from "./http_client";
import { ServiceTransport } from "./transport";

/**
 * Options for constructing an HTTPTransport.
 */
export interface HTTPTransportOptions {
  /** Base URL for the target service */
  url: string;
  /** Auth credentials */
  auth?: ServiceBindingAuth;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Reject unauthorized TLS certificates (default: true) */
  rejectUnauthorized?: boolean;
  /** mTLS client certificate (PEM string or Buffer) */
  cert?: string | Buffer;
  /** mTLS client key (PEM string or Buffer) */
  key?: string | Buffer;
  /** CA certificate for verifying the server (PEM string or Buffer) */
  ca?: string | Buffer;
  /** Additional Axios request config merged into the instance defaults */
  requestConfig?: AxiosRequestConfig;
  /** Optional logger. When provided, each request is logged at debug level with
   *  method, URL, status, and elapsed ms. Errors include the response body. */
  logger?: Logger;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Direct HTTP transport via Axios.
 *
 * Provides connection pooling (KeepAlive), DNS caching, smart retry with
 * exponential backoff, and auth header injection. Used for external/local
 * provider mode where the provider has direct network access.
 */
export class HTTPTransport implements ServiceTransport {
  private http: AxiosInstance;

  constructor(options: HTTPTransportOptions) {
    this.http = axios.create({
      baseURL: options.url,
      ...options.requestConfig,
    });

    configureHttpClient(this.http, {
      auth: options.auth,
      maxRetries: options.maxRetries,
      timeout: options.timeout,
      rejectUnauthorized: options.rejectUnauthorized,
      cert: options.cert,
      key: options.key,
      ca: options.ca,
    });

    if (options.logger) {
      const logger = options.logger;
      this.http.interceptors.request.use((config) => {
        (config as any)._startMs = Date.now();
        return config;
      });
      this.http.interceptors.response.use(
        (response) => {
          const ms = Date.now() - ((response.config as any)._startMs ?? Date.now());
          const method = (response.config.method ?? "GET").toUpperCase();
          logger.debug(`${method} ${response.config.url} ${response.status} ${ms}ms`);
          return response;
        },
        (error: AxiosError) => {
          const ms = Date.now() - ((error.config as any)?._startMs ?? Date.now());
          const method = ((error.config?.method ?? "GET")).toUpperCase();
          const url = error.config?.url ?? "";
          if (error.response) {
            const { status, data } = error.response;
            const body = typeof data === "string" ? data : JSON.stringify(data);
            logger.error(`${method} ${url} failed (${status}) ${ms}ms: ${body}`);
          } else {
            logger.error(`${method} ${url} failed ${ms}ms: ${error.message}`);
          }
          return Promise.reject(error);
        },
      );
    }
  }

  /** Expose the underlying Axios instance for advanced use cases. */
  getHttpInstance(): AxiosInstance {
    return this.http;
  }

  async get<T>(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry & { ignore404?: boolean },
  ): Promise<T | undefined> {
    const { ignore404, ...restConfig } = config || {};
    const response = await this.http.get<T>(url, {
      ...restConfig,
      params,
      validateStatus: (status) =>
        ignore404 ? status === 404 || isSuccess(status) : isSuccess(status),
    });
    return ignore404 && response.status === 404 ? undefined : response.data;
  }

  async post<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    const response = await this.http.post<T>(
      url,
      data,
      config as AxiosRequestConfig,
    );
    return response.data;
  }

  async put<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    const response = await this.http.put<T>(
      url,
      data,
      config as AxiosRequestConfig,
    );
    return response.data;
  }

  async patch<T>(
    url: string,
    data: any,
    config?: RequestConfigWithRetry,
  ): Promise<T> {
    const response = await this.http.patch<T>(
      url,
      data,
      config as AxiosRequestConfig,
    );
    return response.data;
  }

  async delete(
    url: string,
    params?: any,
    config?: RequestConfigWithRetry,
  ): Promise<void> {
    await this.http.delete(url, { ...config, params } as AxiosRequestConfig);
  }
}
