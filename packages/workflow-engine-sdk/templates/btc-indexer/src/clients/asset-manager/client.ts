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

import axios, { AxiosError, type AxiosInstance } from 'axios';
import axiosRetry, { isNetworkError } from 'axios-retry';
import * as http from 'http';
import * as https from 'https';
import type { BulkUpsertInput, BulkUpsertResult } from './bulkupsert.js';
import type { BulkQueryInput, BulkQueryOutput } from './bulkquery.js';

export interface AssetManagerClientOptions {
  url: string;
  /** Pre-formatted auth header value, e.g. "Basic dXNlcjpwYXNz" or "Bearer eyJ..." */
  authToken: string;
  /** Max retry attempts on transient failures (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Asset Manager REST client for the bulk upsert API.
 *
 * Configures Axios with:
 * - KeepAlive agents for connection pooling
 * - Retry with exponential backoff on network errors, 5xx, and 429
 *
 * NOTE: This client will be replaced by @kaleido-io/asset-manager-sdk once it
 * is available. Until then, users own this code and can modify it freely.
 */
export class AssetManagerClient {
  private http: AxiosInstance;

  constructor(options: AssetManagerClientOptions) {
    const maxRetries = options.maxRetries ?? 3;
    const timeout = options.timeout ?? 30_000;

    this.http = axios.create({
      baseURL: options.url.replace(/\/+$/, ''),
      timeout,
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
      headers: { Authorization: options.authToken },
    });

    // Retry on transient failures with exponential backoff.
    // PUT is idempotent, so retrying bulk upserts is safe.
    axiosRetry(this.http, {
      retries: maxRetries,
      retryDelay: axiosRetry.exponentialDelay,
      shouldResetTimeout: true,
      retryCondition: (error: AxiosError) => {
        if (isNetworkError(error)) return true;
        const status = error.response?.status;
        return status === 429 || (status !== undefined && status >= 500);
      },
      onRetry: (retryCount, error, requestConfig) => {
        const status = error.response?.status ?? 'network error';
        console.warn(
          `[AssetManagerClient] retry ${retryCount}/${maxRetries} ` +
            `${requestConfig.url} (${status}: ${error.message})`,
        );
      },
    });
  }

  /** Upsert assets, addresses, pools, transfers, and/or fragments in a single call. */
  async bulkUpsert(input: BulkUpsertInput): Promise<BulkUpsertResult> {
    try {
      const resp = await this.http.put<BulkUpsertResult>('/api/v1/bulk/datamodel', input);
      return resp.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const { status, data } = error.response;
        const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        console.error(`[AssetManagerClient] bulkUpsert failed (${status}):\n${body}`);
        throw new Error(`[AssetManagerClient] bulkUpsert failed (${status}): ${body}`, { cause: error });
      }
      throw error;
    }
  }

  /** Query assets, addresses, pools, transfers, and/or fragments in a single call. */
  async bulkQuery(input: BulkQueryInput): Promise<BulkQueryOutput> {
    try {
      const resp = await this.http.post<BulkQueryOutput>('/api/v1/bulk/query', input);
      return resp.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const { status, data } = error.response;
        const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        console.error(`[AssetManagerClient] bulkQuery failed (${status}):\n${body}`);
        throw new Error(`[AssetManagerClient] bulkQuery failed (${status}): ${body}`, { cause: error });
      }
      throw error;
    }
  }
}
