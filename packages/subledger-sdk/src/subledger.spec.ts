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

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ServiceTransport } from "@kaleido-io/core-sdk/http";
import { SubledgerClient } from "./subledger.js";
import { ErrorCodes, errorCode } from "./errors.js";
import type { BulkQueryInput, BulkUpsertInput } from "./schema.js";

jest.mock("@kaleido-io/core-sdk/http", () => ({
  ServiceClient: jest.requireActual<typeof import("@kaleido-io/core-sdk/http")>(
    "@kaleido-io/core-sdk/http",
  ).ServiceClient,
  createServiceTransport: jest.fn(() => mockTransport),
}));

const mockGet = jest.fn<ServiceTransport["get"]>();
const mockPost = jest.fn<ServiceTransport["post"]>();
const mockPut = jest.fn<ServiceTransport["put"]>();
const mockTransport = {
  get: mockGet,
  post: mockPost,
  put: mockPut,
  patch: jest.fn(),
  delete: jest.fn(),
};

describe("SubledgerClient", () => {
  let client: SubledgerClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SubledgerClient({ transport: "http", url: "http://localhost" });
  });

  it("bulkUpsert sends the body unchanged to PUT /api/v1/bulk and returns the response", async () => {
    const input: BulkUpsertInput = {
      lifecycle: {
        transactions: [
          {
            transactionTypeUrn: "td-transfer",
            updateStrategy: "create_only",
            items: [{ name: "tx1" }],
          },
        ],
      },
    };
    const output = {
      lifecycle: {
        transactions: [
          { transactionTypeUrn: "urn:kld:transactiontype=td-transfer", created: ["u1"] },
        ],
      },
    };
    mockPut.mockResolvedValue(output);

    await expect(client.bulkUpsert(input)).resolves.toBe(output);
    expect(mockPut).toHaveBeenCalledWith("/api/v1/bulk", input, undefined);
  });

  it("bulkQuery sends the body unchanged to POST /api/v1/bulk/query, retrying 5xx", async () => {
    const input: BulkQueryInput = {
      lifecycle: {
        transactions: [
          { transactionTypeUrn: "td-transfer", equal: [{ field: "name", value: "tx1" }] },
        ],
      },
      options: { includeChildren: true },
    };
    mockPost.mockResolvedValue({});

    await client.bulkQuery(input);
    expect(mockPost).toHaveBeenCalledWith("/api/v1/bulk/query", input, { retryOn5xx: true });
  });

  it("getStatus calls GET /api/v1/status", () => {
    client.getStatus();
    expect(mockGet).toHaveBeenCalledWith("/api/v1/status", undefined, undefined);
  });

  it("omits the version prefix only when the URL carries it", () => {
    new SubledgerClient({
      transport: "http",
      url: "http://svc:5000/api/v1/namespaces/sl",
    }).getStatus();
    new SubledgerClient({ transport: "ws-proxy" } as any).getStatus();
    expect(mockGet.mock.calls.map((c) => c[0])).toEqual(["/status", "/api/v1/status"]);
  });

  it("resolves the subledger binding from a setup context by default", () => {
    const getServiceClientOptions = jest.fn(() => ({
      transport: "http" as const,
      url: "http://localhost",
    }));
    new SubledgerClient({ getServiceClientOptions } as any);
    new SubledgerClient({ getServiceClientOptions } as any, "subledger-2");
    expect(getServiceClientOptions.mock.calls).toEqual([["subledger"], ["subledger-2"]]);
  });

  it("passes the context signal to new builders", async () => {
    const signal = new AbortController().signal;
    const ctx = {
      getServiceClientOptions: () => ({ transport: "http", url: "http://localhost" }),
      signal,
    };
    mockPut.mockResolvedValue({});

    const b = new SubledgerClient(ctx as any).getNewBulkUpsertBuilder({
      defaults: { updateStrategy: "create_or_ignore" },
    });
    b.registry.add({ assets: { items: [{ name: "USD", decimals: 2 }] } });
    await b.execute();
    expect(mockPut.mock.calls[0][2]).toEqual({ signal });
  });
});

describe("errorCode", () => {
  it("reads the code from an HTTP error body or an error message", () => {
    expect(errorCode({ response: { data: { error: "KA240201: Conflict on insert" } } })).toBe(
      ErrorCodes.UniqueConflict,
    );
    expect(
      errorCode(
        new Error(
          "Service proxy returned 400: KA240225: A bulk write must not contain the same URN twice",
        ),
      ),
    ).toBe(ErrorCodes.DuplicateUrn);
    expect(errorCode(new Error("socket hang up"))).toBeUndefined();
  });
});
