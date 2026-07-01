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

import {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import axiosRetry, { isNetworkError } from "axios-retry";
import CacheableLookup from "cacheable-lookup";
import * as dns from "dns";
import * as http from "http";
import * as https from "https";
import { ServiceBindingAuth } from "./types";
import { newLogger } from "../log/logger";

const log = newLogger("http_client");

/**
 * Per-request metadata attached by the request interceptor and read back by
 * the response interceptor. Kept on the request config so it survives retries.
 */
interface RequestTrace {
  startMs: number;
}

type TracedRequestConfig = InternalAxiosRequestConfig & {
  __kaleidoTrace?: RequestTrace;
};

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
  /** mTLS client certificate (PEM string or Buffer) */
  cert?: string | Buffer;
  /** mTLS client key (PEM string or Buffer) */
  key?: string | Buffer;
  /** CA certificate for verifying the server (PEM string or Buffer) */
  ca?: string | Buffer;
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
 */
export function configureHttpClient(
  instance: AxiosInstance,
  options: HttpClientOptions = {},
): AxiosInstance {
  const maxRetries = options.maxRetries ?? 3;
  const timeout = options.timeout ?? 30000;
  // Respect NODE_TLS_REJECT_UNAUTHORIZED=0 when no explicit override is set.
  const rejectUnauthorized =
    options.rejectUnauthorized ?? process.env["NODE_TLS_REJECT_UNAUTHORIZED"] !== "0";

  // Configure keepAlive agents with connection pool limits
  const httpsAgent = new https.Agent({
    keepAlive: true,
    rejectUnauthorized,
    maxSockets: 50,
    maxFreeSockets: 10,
    ...(options.cert && { cert: options.cert }),
    ...(options.key  && { key:  options.key  }),
    ...(options.ca   && { ca:   options.ca   }),
  });

  const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
  });

  // Cache DNS lookups to avoid repeated syscalls, using the system resolver
  // (dns.lookup) so that /etc/hosts entries are respected. The default
  // CacheableLookup resolver uses dns.resolve*() which bypasses /etc/hosts.
  const cacheable = new CacheableLookup();
  cacheable.lookup = dns.lookup.bind(dns) as typeof cacheable.lookup;
  cacheable.install(httpsAgent);
  cacheable.install(httpAgent);

  // Replace the default agents with the enhanced ones
  instance.defaults.httpsAgent = httpsAgent;
  instance.defaults.httpAgent = httpAgent;
  instance.defaults.timeout = timeout;

  // Header name we expect to see carrying the configured ServiceBindingAuth on
  // every outbound request. Used by the request interceptor below to verify
  // that the auth header survived all the way to the wire (e.g. wasn't
  // accidentally stripped by a per-request `headers` override).
  let configuredAuthHeader: string | undefined;
  const authConfigured = options.auth !== undefined;

  if (options.auth) {
    const resolved = resolveAuthHeader(options.auth);
    if (resolved) {
      instance.defaults.headers.common[resolved.headerName] =
        resolved.headerValue;
      configuredAuthHeader = resolved.headerName;
    } else {
      log.warn(
        `ServiceBindingAuth of type '${options.auth.type}' was provided but had no usable credentials; ` +
          `no auth header will be attached to outbound requests.`,
      );
    }
  }

  installTracingInterceptors(instance, {
    authConfigured,
    configuredAuthHeader,
  });

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

/**
 * Build the full target URL for logging without leaking query string secrets.
 * Returns `<method> <baseURL?><url>`.
 */
function formatRequestTarget(config: AxiosRequestConfig): string {
  const method = (config.method ?? "GET").toUpperCase();
  const base = config.baseURL ?? "";
  const url = config.url ?? "";
  return `${method} ${base}${url}`;
}

/**
 * Look up a header value on an axios request config in a way that works for
 * both AxiosHeaders (v1.x) and plain object header maps. Header names are
 * matched case-insensitively per RFC 7230.
 */
function getRequestHeader(
  config: InternalAxiosRequestConfig,
  name: string,
): string | undefined {
  const headers: any = config.headers;
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    const v = headers.get(name);
    return v == null ? undefined : String(v);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return v == null ? undefined : String(v);
    }
  }
  return undefined;
}

/**
 * Install request/response interceptors that emit per-request debug logs so
 * callers can verify (a) that axios is actually issuing the requests they
 * expect and (b) that the configured `ServiceBindingAuth` is still being
 * attached as an Authorization-style header on every call.
 *
 * Auth values are never logged — only the presence/absence of the expected
 * header and its length are recorded.
 */
function installTracingInterceptors(
  instance: AxiosInstance,
  ctx: { authConfigured: boolean; configuredAuthHeader?: string },
): void {
  instance.interceptors.request.use((config) => {
    const traced = config as TracedRequestConfig;
    traced.__kaleidoTrace = { startMs: Date.now() };

    const target = formatRequestTarget(config);

    let authStatus: string;
    if (!ctx.authConfigured) {
      authStatus = "no ServiceBindingAuth configured";
    } else if (!ctx.configuredAuthHeader) {
      authStatus = "ServiceBindingAuth configured but unresolved (missing creds)";
    } else {
      const value = getRequestHeader(config, ctx.configuredAuthHeader);
      authStatus = value
        ? `auth header '${ctx.configuredAuthHeader}' present (len=${value.length})`
        : `auth header '${ctx.configuredAuthHeader}' MISSING from outbound request`;
    }

    log.debug(`-> ${target} [${authStatus}]`);
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const traced = response.config as TracedRequestConfig;
      const elapsed = traced.__kaleidoTrace
        ? Date.now() - traced.__kaleidoTrace.startMs
        : undefined;
      const target = formatRequestTarget(response.config);
      const dur = elapsed !== undefined ? ` ${elapsed}ms` : "";
      log.debug(`<- ${target} ${response.status}${dur}`);
      return response;
    },
    (error: AxiosError) => {
      const config = error.config as TracedRequestConfig | undefined;
      const target = config
        ? formatRequestTarget(config)
        : "<unknown request>";
      const elapsed =
        config?.__kaleidoTrace !== undefined
          ? Date.now() - config.__kaleidoTrace.startMs
          : undefined;
      const dur = elapsed !== undefined ? ` ${elapsed}ms` : "";
      const status = error.response?.status ?? "network error";
      log.debug(`<- ${target} ${status}${dur}: ${error.message}`);
      return Promise.reject(error);
    },
  );
}
