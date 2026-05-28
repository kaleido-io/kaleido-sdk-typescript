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

import { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRetry, { isNetworkError } from "axios-retry";
import CacheableLookup from "cacheable-lookup";
import * as http from "http";
import * as https from "https";
import { ServiceBindingAuth } from "./types";
import { newLogger } from "../log/logger";

const log = newLogger("http_client");

/**
 * Per-request retry override options.
 *
 * Default behavior by HTTP method:
 * - GET/HEAD/OPTIONS/PUT/DELETE (idempotent): retry on network errors, 5xx, and 429
 * - POST/PATCH (non-idempotent): retry only on network errors and 429
 */
export interface RetryConfig {
  /** Disable retry entirely for this request. @default true */
  retry?: boolean;
  /** Retry on 5xx. @default true for idempotent methods, false for POST/PATCH */
  retryOn5xx?: boolean;
  /** Retry on network errors. @default true */
  retryOnNetworkError?: boolean;
  /** Retry on 429 Too Many Requests. @default true */
  retryOnRateLimit?: boolean;
}

export type RequestConfigWithRetry = AxiosRequestConfig & RetryConfig;

export interface HttpClientOptions {
  auth?: ServiceBindingAuth;
  maxRetries?: number;
  timeout?: number;
  rejectUnauthorized?: boolean;
}

const IDEMPOTENT_METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];

function isIdempotentMethod(method?: string): boolean {
  return IDEMPOTENT_METHODS.includes((method ?? "GET").toUpperCase());
}

function isServerError(error: AxiosError): boolean {
  const status = error.response?.status;
  return status !== undefined && status >= 500 && status <= 599;
}

function isRateLimitError(error: AxiosError): boolean {
  return error.response?.status === 429;
}

function getRetryConfig(
  config: RequestConfigWithRetry | undefined,
): Required<RetryConfig> {
  const isIdempotent = isIdempotentMethod(config?.method);
  return {
    retry: config?.retry ?? true,
    retryOn5xx: config?.retryOn5xx ?? isIdempotent,
    retryOnNetworkError: config?.retryOnNetworkError ?? true,
    retryOnRateLimit: config?.retryOnRateLimit ?? true,
  };
}

/**
 * Resolve a ServiceBindingAuth into an Authorization header value.
 */
function resolveAuthHeader(
  auth: ServiceBindingAuth,
): { headerName: string; headerValue: string } | undefined {
  switch (auth.type) {
    case "basic": {
      if (!auth.username || !auth.password) return undefined;
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString(
        "base64",
      );
      return { headerName: "Authorization", headerValue: `Basic ${encoded}` };
    }
    case "token": {
      if (!auth.token) return undefined;
      const headerName = auth.header || "Authorization";
      const scheme = auth.scheme || "";
      const headerValue = scheme ? `${scheme} ${auth.token}` : auth.token;
      return { headerName, headerValue };
    }
    default:
      return undefined;
  }
}

/**
 * Enhance an Axios instance with production-quality HTTP client features:
 * - KeepAlive connection pooling
 * - DNS caching via cacheable-lookup
 * - Retry with exponential backoff (smart: idempotent vs non-idempotent)
 * - Per-request retry override
 * - Auth header injection from ServiceBindingAuth
 *
 * Framework-agnostic port of kaleido-studio-nest-base/http configureHttpClient.
 */
export function configureHttpClient(
  instance: AxiosInstance,
  options: HttpClientOptions = {},
): AxiosInstance {
  const maxRetries = options.maxRetries ?? 3;
  const timeout = options.timeout ?? 30000;
  const rejectUnauthorized = options.rejectUnauthorized ?? true;

  // Configure keepAlive agents with connection pool limits
  const httpsAgent = new https.Agent({
    keepAlive: true,
    rejectUnauthorized,
    maxSockets: 50,
    maxFreeSockets: 10,
  });

  const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
  });

  // Cache DNS lookups to avoid expensive syscalls
  // Node's default behavior is to make a syscall for every query, which can be
  // resource-intensive and cause spurious failures depending on OS and load.
  const cacheable = new CacheableLookup();
  cacheable.install(httpsAgent);
  cacheable.install(httpAgent);

  // Replace the default agents with the enhanced ones
  instance.defaults.httpsAgent = httpsAgent;
  instance.defaults.httpAgent = httpAgent;
  instance.defaults.timeout = timeout;

  if (options.auth) {
    const resolved = resolveAuthHeader(options.auth);
    if (resolved) {
      instance.defaults.headers.common[resolved.headerName] =
        resolved.headerValue;
    }
  }

  // Configure retry logic with exponential backoff
  axiosRetry(instance, {
    retries: maxRetries,
    retryDelay: axiosRetry.exponentialDelay,
    shouldResetTimeout: true,
    retryCondition: (error: AxiosError) => {
      const retryConfig = getRetryConfig(
        error.config as RequestConfigWithRetry,
      );

      if (!retryConfig.retry) {
        return false;
      }
      if (retryConfig.retryOnRateLimit && isRateLimitError(error)) {
        return true;
      }
      if (retryConfig.retryOn5xx && isServerError(error)) {
        return true;
      }
      if (retryConfig.retryOnNetworkError && isNetworkError(error)) {
        return true;
      }
      return false;
    },
    onRetry: (retryCount, error, requestConfig) => {
      const statusCode = error.response?.status || "network error";
      const retryAfter = error.response?.headers?.["retry-after"];
      const retryAfterInfo = retryAfter ? ` (Retry-After: ${retryAfter})` : "";
      const logMessage =
        `Retrying request to '${requestConfig.url}' due to '${statusCode}': ` +
        `'${error.message}'${retryAfterInfo}. Attempt ${retryCount}/${maxRetries}.`;

      log.warn(logMessage);
    },
  });

  return instance;
}
