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

import { jest } from "@jest/globals";

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("../log/logger", () => ({
  newLogger: jest.fn(() => mockLogger),
}));

import { IWSProxy, WSProxyResponse, WSProxyTransport } from "./ws_proxy_transport";

function makeProxy(response: WSProxyResponse) {
  const request =
    jest.fn<
      (
        serviceType: string,
        method: string,
        id: string,
        body?: any,
        headers?: Record<string, string>,
        path?: string,
        authRef?: string,
      ) => Promise<WSProxyResponse>
    >();
  request.mockResolvedValue(response);
  const proxy: IWSProxy = { request };
  return { proxy, request };
}

function encode(obj: any): string {
  return Buffer.from(JSON.stringify(obj), "utf-8").toString("base64");
}

describe("WSProxyTransport query params", () => {
  const ok = (body: any): WSProxyResponse => ({
    status: 200,
    bodyBase64: encode(body),
  });

  it("forwards GET params onto the proxied URL query string", async () => {
    const { proxy, request } = makeProxy(ok({ items: [] }));
    const transport = new WSProxyTransport({ wsProxy: proxy, serviceType: "asset-manager", id: "am1" });

    await transport.get("/api/v1/assets", { field: "tokenId", value: "42" });

    // The path argument (6th positional) carries the serialized query string.
    const path = request.mock.calls[0][5] as string;
    expect(path).toBe("/api/v1/assets?field=tokenId&value=42");
  });

  it("serializes array params as repeated keys and skips null/undefined", async () => {
    const { proxy, request } = makeProxy(ok({ items: [] }));
    const transport = new WSProxyTransport({ wsProxy: proxy, serviceType: "asset-manager", id: "am1" });

    await transport.get("/api/v1/assets", { label: ["a", "b"], skip: undefined, gone: null });

    const path = request.mock.calls[0][5] as string;
    expect(path).toBe("/api/v1/assets?label=a&label=b");
  });

  it("appends with & when the URL already has a query string", async () => {
    const { proxy, request } = makeProxy(ok({ items: [] }));
    const transport = new WSProxyTransport({ wsProxy: proxy, serviceType: "asset-manager", id: "am1" });

    await transport.get("/api/v1/assets?limit=10", { field: "name" });

    const path = request.mock.calls[0][5] as string;
    expect(path).toBe("/api/v1/assets?limit=10&field=name");
  });

  it("leaves the URL unchanged when no params are given", async () => {
    const { proxy, request } = makeProxy(ok({ items: [] }));
    const transport = new WSProxyTransport({ wsProxy: proxy, serviceType: "asset-manager", id: "am1" });

    await transport.get("/api/v1/assets");

    expect(request.mock.calls[0][5]).toBe("/api/v1/assets");
  });

  it("forwards DELETE params onto the proxied URL", async () => {
    const { proxy, request } = makeProxy({ status: 204 });
    const transport = new WSProxyTransport({ wsProxy: proxy, serviceType: "asset-manager", id: "am1" });

    await transport.delete("/api/v1/assets", { field: "name", value: "stale" });

    expect(request.mock.calls[0][5]).toBe("/api/v1/assets?field=name&value=stale");
  });
});
