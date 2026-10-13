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
import { resolveServiceBinding } from "@kaleido-io/core-sdk";
import type { SetupContext } from "@kaleido-io/core-sdk/context";
import {
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
} from "@kaleido-io/core-sdk/http";
import { AxiosRequestConfig } from "axios";
import { BulkUpsertBuilder, type BulkUpsertBuilderOptions } from "./bulk-upsert-builder.js";
import type {
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  BulkUpsertOutput,
  SubledgerStatus,
} from "./schema.js";

const DEFAULT_BINDING = "subledger";

// Add /api/v1 to the URL if it doesn't already have it. This is needed for both
// the hosted and direct transport.
function apiVersion(opts: ServiceClientOptions): string {
  if (opts.transport === "http" && opts.url?.includes("/api/v1")) {
    return "";
  }
  return "/api/v1";
}

function resolveOptions(
  ctxOrOptsOrName: SetupContext | ServiceClientOptions | string,
  bindingName?: string,
): ServiceClientOptions {
  if (typeof ctxOrOptsOrName === "string") {
    return resolveServiceBinding(ctxOrOptsOrName);
  }
  if ("getServiceClientOptions" in ctxOrOptsOrName) {
    return ctxOrOptsOrName.getServiceClientOptions(bindingName ?? DEFAULT_BINDING);
  }
  return ctxOrOptsOrName;
}

/**
 * Typed client for the Subledger service.
 *
 *   new SubledgerClient(ctx);                 // handler context, "subledger" binding
 *   new SubledgerClient(ctx, "subledger-2");
 *   new SubledgerClient("subledger");         // binding name from the config file
 *   new SubledgerClient(serviceClientOptions);
 */
export class SubledgerClient extends ServiceClient {
  private readonly apiVersion: string;
  private readonly defaultBulkUpsertSignal?: AbortSignal;

  /** Build a client from a non-hosted binding in the Kaleido config file. */
  static fromConfigFile(bindingName = DEFAULT_BINDING, configFilePath?: string): SubledgerClient {
    return new SubledgerClient(resolveServiceBinding(bindingName, configFilePath));
  }

  constructor(ctxOrOptsOrName: SetupContext | ServiceClientOptions | string, bindingName?: string) {
    const opts = resolveOptions(ctxOrOptsOrName, bindingName);
    super(createServiceTransport(opts));
    this.apiVersion = apiVersion(opts);
    if (typeof ctxOrOptsOrName !== "string" && "getServiceClientOptions" in ctxOrOptsOrName) {
      this.defaultBulkUpsertSignal = ctxOrOptsOrName.signal;
    }
  }

  getNewBulkUpsertBuilder(options: BulkUpsertBuilderOptions): BulkUpsertBuilder {
    return new BulkUpsertBuilder(this, {
      ...options,
      signal: options.signal ?? this.defaultBulkUpsertSignal,
    });
  }

  getStatus() {
    return this.get<SubledgerStatus>(`${this.apiVersion}/status`);
  }

  bulkUpsert(input: BulkUpsertInput, options?: AxiosRequestConfig): Promise<BulkUpsertOutput> {
    return this.put<BulkUpsertOutput>(`${this.apiVersion}/bulk`, input, options);
  }

  bulkQuery(input: BulkQueryInput, options?: AxiosRequestConfig): Promise<BulkQueryOutput> {
    return this.post<BulkQueryOutput>(`${this.apiVersion}/bulk/query`, input, {
      retryOn5xx: true,
      ...options,
    });
  }
}
