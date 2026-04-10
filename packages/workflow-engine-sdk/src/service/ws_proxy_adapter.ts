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

import { invocationContext } from "../context/invocation_context";
import { newLogger } from "../log/logger";
import {
  WSMessageType,
  ServiceProxyRequest,
  ServiceProxyResponse,
} from "../types/core";

const log = newLogger("ws_proxy_adapter");

/**
 * Interface satisfied by HandlerRuntime, allowing the adapter to send
 * messages over the runtime's existing WebSocket connection.
 *
 * In hosted mode, this WebSocket points to the provider-proxy which
 * transparently forwards WFE protocol messages while intercepting
 * service_proxy_request messages for local HTTP execution.
 */
export interface ProxyAdapterRuntime {
  sendMessage(message: any): void;
  isWebSocketConnected(): boolean;
}

/**
 * WebSocket service proxy adapter.
 *
 * Correlates outgoing ServiceProxyRequest messages with incoming
 * ServiceProxyResponse messages, using the runtime's existing WebSocket
 * connection as the transport.
 *
 * In hosted mode the runtime's WebSocket points to the provider-proxy,
 * which acts as a man-in-the-middle: forwarding WFE protocol messages
 * to the real workflow engine and handling service proxy requests itself.
 *
 * Lifecycle:
 * - Created by HandlerRuntime in its constructor
 * - Wired via setRuntime() so it can send on the runtime's WebSocket
 * - SERVICE_PROXY_RESPONSE messages are routed here by HandlerRuntime.handleMessage()
 */
export class WSProxyAdapter {
  private runtime?: ProxyAdapterRuntime;

  private inflightRequests: Map<
    string,
    {
      resolve: (data: ServiceProxyResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  private requestTimeoutMs: number;

  constructor(requestTimeoutMs?: number) {
    this.requestTimeoutMs = requestTimeoutMs ?? 120_000;
  }

  /**
   * Bind to the handler runtime that owns the WebSocket connection.
   */
  setRuntime(runtime: ProxyAdapterRuntime): void {
    this.runtime = runtime;
  }

  /**
   * Handle an incoming SERVICE_PROXY_RESPONSE.
   * Called by HandlerRuntime.handleMessage() when a response arrives
   * on the shared WebSocket connection.
   */
  handleResponse(response: ServiceProxyResponse): void {
    const inflight = this.inflightRequests.get(response.requestId);
    if (!inflight) {
      log.warn("Received proxy response for unknown request", {
        requestId: response.requestId,
      });
      return;
    }
    clearTimeout(inflight.timer);
    this.inflightRequests.delete(response.requestId);

    if (response.error && (!response.status || response.status >= 400)) {
      inflight.reject(new Error(`Service proxy error: ${response.error}`));
    } else {
      inflight.resolve(response);
    }
  }

  /**
   * Send a service proxy request over the runtime's WebSocket.
   * The provider-proxy on the other end intercepts these and makes
   * the actual HTTP call with managed auth credentials.
   */
  async request(
    serviceType: string,
    method: string,
    id: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<ServiceProxyResponse> {
    const requestId = generateId();

    const message: ServiceProxyRequest = {
      messageType: WSMessageType.SERVICE_PROXY_REQUEST,
      requestId,
      serviceType,
      id,
      authRef: invocationContext.getStore()?.authRef,
      request: {
        method,
        headers,
        bodyBase64: body
          ? Buffer.from(JSON.stringify(body)).toString("base64")
          : undefined,
      },
    };

    return new Promise<ServiceProxyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflightRequests.delete(requestId);
        reject(
          new Error(
            `Service proxy request timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);

      this.inflightRequests.set(requestId, { resolve, reject, timer });

      if (this.runtime && this.runtime.isWebSocketConnected()) {
        this.runtime.sendMessage(message);
      } else {
        this.inflightRequests.delete(requestId);
        clearTimeout(timer);
        reject(
          new Error(
            "WSProxyAdapter: runtime WebSocket not connected",
          ),
        );
      }
    });
  }

  /**
   * Cancel all in-flight requests (e.g. on disconnect).
   */
  cancelAll(): void {
    for (const [_, inflight] of this.inflightRequests) {
      clearTimeout(inflight.timer);
      inflight.reject(new Error("WSProxyAdapter: connection closed"));
    }
    this.inflightRequests.clear();
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
