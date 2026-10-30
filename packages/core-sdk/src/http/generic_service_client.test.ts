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

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createServer, IncomingMessage, Server } from "http";
import { AddressInfo } from "net";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

jest.mock("../log/logger", () => ({
  newLogger: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

import { GenericServiceClient } from "./generic_service_client";
import type { IWSProxy, WSProxyResponse } from "./ws_proxy_transport";

interface Recorded {
  method: string;
  url: string;
  authorization?: string;
  body?: unknown;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

describe("GenericServiceClient", () => {
  let server: Server;
  let baseUrl: string;
  const recorded: Recorded[] = [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      recorded.push({ method: req.method!, url: req.url!, authorization: req.headers.authorization, body: await readBody(req) });
      if (req.url?.startsWith("/missing")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (req.url?.startsWith("/broken")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "broken" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const httpOptions = () => ({
    transport: "http" as const,
    url: baseUrl,
    auth: { type: "basic" as const, username: "user", password: "pass" },
    maxRetries: 0,
  });

  it("sends each method to a path relative to the service, with the binding's credentials", async () => {
    recorded.length = 0;
    const client = new GenericServiceClient(httpOptions());
    expect(await client.get("/api/v1/things", { limit: 2 })).toEqual({ ok: true, method: "GET" });
    expect(await client.post("/api/v1/things", { name: "a" })).toEqual({ ok: true, method: "POST" });
    expect(await client.put("/api/v1/things/a", { name: "b" })).toEqual({ ok: true, method: "PUT" });
    expect(await client.patch("/api/v1/things/a", { name: "c" })).toEqual({ ok: true, method: "PATCH" });
    await client.delete("/api/v1/things/a");
    const basic = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    expect(recorded).toEqual([
      { method: "GET", url: "/api/v1/things?limit=2", authorization: basic, body: undefined },
      { method: "POST", url: "/api/v1/things", authorization: basic, body: { name: "a" } },
      { method: "PUT", url: "/api/v1/things/a", authorization: basic, body: { name: "b" } },
      { method: "PATCH", url: "/api/v1/things/a", authorization: basic, body: { name: "c" } },
      { method: "DELETE", url: "/api/v1/things/a", authorization: basic, body: undefined },
    ]);
  });

  it("throws on an error status, and returns undefined for an ignored 404", async () => {
    const client = new GenericServiceClient(httpOptions());
    await expect(client.get("/broken")).rejects.toThrow();
    expect(await client.get("/missing", undefined, { ignore404: true })).toBeUndefined();
  });

  it("resolves a binding through a handler's context, as the caller", async () => {
    const request = jest.fn<IWSProxy["request"]>().mockResolvedValue({
      status: 200,
      bodyBase64: Buffer.from(JSON.stringify({ items: [] })).toString("base64"),
    } as WSProxyResponse);
    const getServiceClientOptions = jest.fn((name: string) => ({
      transport: "ws-proxy" as const,
      wsProxy: { request },
      serviceType: "ArtifactRegistryService",
      id: `s-${name}`,
      authRef: "caller-auth",
    }));
    const client = new GenericServiceClient({ getServiceClientOptions }, "registry");
    expect(await client.get("/api/v1/namespaces")).toEqual({ items: [] });
    expect(getServiceClientOptions).toHaveBeenCalledWith("registry");
    expect(request).toHaveBeenCalledWith("ArtifactRegistryService", "GET", "s-registry", undefined, undefined, "/api/v1/namespaces", "caller-auth");
  });

  it("needs a binding name when constructed from a context", () => {
    expect(() => new GenericServiceClient({ getServiceClientOptions: jest.fn() } as never, undefined as never)).toThrow(
      "GenericServiceClient needs a binding name when constructed from a context",
    );
  });

  it("resolves a non-hosted binding by name from the Kaleido config file", async () => {
    recorded.length = 0;
    const dir = mkdtempSync(join(tmpdir(), "generic-client-"));
    const configFile = join(dir, "config.yaml");
    writeFileSync(configFile, [
      "service-bindings:",
      "  orders:",
      "    bindingType: non-hosted",
      `    url: ${baseUrl}`,
      "    auth:",
      "      type: token",
      "      token: secret",
      "      scheme: Bearer",
      "    maxRetries: 0",
    ].join("\n"));
    const previous = process.env.KALEIDO_CONFIG_FILE;
    process.env.KALEIDO_CONFIG_FILE = configFile;
    try {
      const client = new GenericServiceClient("orders");
      expect(await client.get("/orders/1")).toEqual({ ok: true, method: "GET" });
      expect(recorded[0]).toMatchObject({ url: "/orders/1", authorization: "Bearer secret" });
    } finally {
      if (previous === undefined) delete process.env.KALEIDO_CONFIG_FILE;
      else process.env.KALEIDO_CONFIG_FILE = previous;
    }
  });
});
