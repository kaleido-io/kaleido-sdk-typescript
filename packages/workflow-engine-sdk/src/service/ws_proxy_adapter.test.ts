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

jest.mock("@kaleido-io/core-sdk/log", () => ({
  newLogger: jest.fn(() => mockLogger),
}));

import { WSProxyAdapter, ProxyAdapterRuntime } from "./ws_proxy_adapter";
import { WSMessageType, ServiceProxyResponse } from "../types/core";

function createMockRuntime(): ProxyAdapterRuntime & { lastMessage: any } {
  return {
    lastMessage: null,
    sendMessage(msg: any) {
      this.lastMessage = msg;
    },
    isWebSocketConnected: true,
  };
}

/** Flush microtasks so async waitForConnection resolves before checking side-effects. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("WSProxyAdapter", () => {
  it("should send a ServiceProxyRequest over WebSocket", async () => {
    const adapter = new WSProxyAdapter(5000);
    const runtime = createMockRuntime();
    adapter.setRuntime(runtime);

    const promise = adapter.request(
      "asset-manager",
      "POST",
      "u:1234",
      { assets: [] },
      { "Content-Type": "application/json" },
    );

    await tick();
    expect(runtime.lastMessage).not.toBeNull();
    expect(runtime.lastMessage.messageType).toBe(
      WSMessageType.SERVICE_PROXY_REQUEST,
    );
    expect(runtime.lastMessage.serviceType).toBe("asset-manager");
    expect(runtime.lastMessage.id).toBe("u:1234");
    expect(runtime.lastMessage.request.method).toBe("POST");
    expect(runtime.lastMessage.request.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(runtime.lastMessage.request.bodyBase64).toBeDefined();

    const decoded = JSON.parse(
      Buffer.from(runtime.lastMessage.request.bodyBase64, "base64").toString(),
    );
    expect(decoded).toEqual({ assets: [] });

    const response: ServiceProxyResponse = {
      messageType: WSMessageType.SERVICE_PROXY_RESPONSE,
      requestId: runtime.lastMessage.requestId,
      status: 200,
      bodyBase64: Buffer.from(JSON.stringify({ ok: true })).toString("base64"),
    };
    adapter.handleResponse(response);

    const result = await promise;
    expect(result.status).toBe(200);
  });

  it("should reject on error response", async () => {
    const adapter = new WSProxyAdapter(5000);
    const runtime = createMockRuntime();
    adapter.setRuntime(runtime);

    const promise = adapter.request("asset-manager", "GET", "u:1234");
    await tick();

    const response: ServiceProxyResponse = {
      messageType: WSMessageType.SERVICE_PROXY_RESPONSE,
      requestId: runtime.lastMessage.requestId,
      status: 500,
      error: "Internal Server Error",
    };
    adapter.handleResponse(response);

    await expect(promise).rejects.toThrow("Service proxy error");
  });

  it("should reject on timeout", async () => {
    const adapter = new WSProxyAdapter(100);
    const runtime = createMockRuntime();
    adapter.setRuntime(runtime);

    const promise = adapter.request("asset-manager", "GET", "u:1234");
    await expect(promise).rejects.toThrow("timed out");
  });

  it("should throw if runtime not bound (after timeout)", async () => {
    // Uses a short timeout so the wait-for-connection loop exits quickly.
    const adapter = new WSProxyAdapter(200);
    await expect(adapter.request("x", "GET", "u:1234")).rejects.toThrow(
      "not connected",
    );
  }, 1000);

  it("should throw if WebSocket not connected (after timeout)", async () => {
    // Uses a short timeout so the wait-for-connection loop exits quickly.
    const adapter = new WSProxyAdapter(200);
    adapter.setRuntime({
      sendMessage: jest.fn(),
      isWebSocketConnected: false,
    });
    await expect(adapter.request("x", "GET", "u:1234")).rejects.toThrow(
      "not connected",
    );
  }, 1000);

  it("should cancel all inflight requests", async () => {
    const adapter = new WSProxyAdapter(60000);
    const runtime = createMockRuntime();
    adapter.setRuntime(runtime);

    const promise = adapter.request("x", "GET", "u:1234");
    await tick();  // let waitForConnection resolve and request enter inflight map
    adapter.cancelAll();

    await expect(promise).rejects.toThrow("connection closed");
  });

  it("should warn on response for unknown request", () => {
    const adapter = new WSProxyAdapter();
    const runtime = createMockRuntime();
    adapter.setRuntime(runtime);

    adapter.handleResponse({
      messageType: WSMessageType.SERVICE_PROXY_RESPONSE,
      requestId: "unknown-id",
      status: 200,
    });

    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
