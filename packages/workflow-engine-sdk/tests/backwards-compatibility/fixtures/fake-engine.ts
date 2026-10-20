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

// An in-process stand-in for the workflow engine (and, for hosted service
// bindings, the provider proxy). A real WorkflowEngineClient connects to it in
// outbound mode. It records every message the provider sends, lets a test send
// engine requests and wait for the matching reply, and answers the provider's
// own calls back to the engine and to hosted services.
//
// It depends only on `ws` and Node built-ins, and speaks the wire format as
// plain JSON, so it can be copied into another repository's tests unchanged.

import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';

export type WireMessage = Record<string, any>;

export interface ServiceProxyReply {
  status: number;
  body?: unknown;
  error?: string;
}

export interface FakeEngineOptions {
  /** Answers each service-proxy-request. Defaults to a 200 reply echoing the request. */
  onServiceProxyRequest?: (msg: WireMessage) => ServiceProxyReply;
  /** Answers each engineapi_submit_transactions. Defaults to accepting every transaction. */
  onSubmitTransactions?: (msg: WireMessage) => { submissions?: unknown[]; error?: string };
  /** How long to wait for a reply before failing. */
  timeoutMs?: number;
}

const REPLY_TYPES: Record<string, string> = {
  handle_transactions: 'handle_transactions_result',
  event_source_poll: 'event_source_poll_result',
  event_source_validate_config: 'event_source_validate_config_result',
  event_source_delete: 'event_source_delete_result',
  event_processor_batch: 'event_processor_batch_result',
};

export class FakeEngine {
  /** Every message received from the provider, in arrival order. */
  readonly received: WireMessage[] = [];

  private server?: Server;
  private wss?: WebSocketServer;
  private socket?: WebSocket;
  private waiters: { match: (m: WireMessage) => boolean; resolve: (m: WireMessage) => void }[] = [];
  private readonly options: FakeEngineOptions;

  constructor(options: FakeEngineOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.server = createServer();
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      this.socket = ws;
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  get url(): string {
    const { port } = this.server!.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/ws`;
  }

  async close(): Promise<void> {
    for (const client of this.wss?.clients ?? []) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss ? this.wss.close(() => resolve()) : resolve());
    await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
  }

  /** Send a message to the provider without waiting for anything. */
  send(msg: WireMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('FakeEngine: no provider connected');
    }
    this.socket.send(JSON.stringify(msg));
  }

  /** Send an engine request and wait for the provider's reply with the same id. */
  async request(msg: WireMessage): Promise<WireMessage> {
    const replyType = REPLY_TYPES[msg.messageType];
    if (!replyType) {
      throw new Error(`FakeEngine: ${msg.messageType} has no reply`);
    }
    const reply = this.waitFor((m) => m.messageType === replyType && m.id === msg.id);
    this.send(msg);
    return reply;
  }

  /** Send a setup trigger, as the provider proxy does, and wait for its response. */
  async triggerSetup(requestId: string, authRef: string): Promise<WireMessage> {
    const reply = this.waitFor((m) => m.messageType === 'setup-trigger-response' && m.requestId === requestId);
    this.send({ messageType: 'setup-trigger-request', requestId, authRef });
    return reply;
  }

  /** Wait for a message from the provider, including one that already arrived. */
  waitFor(match: (m: WireMessage) => boolean, timeoutMs = this.options.timeoutMs ?? 5000): Promise<WireMessage> {
    const existing = this.received.find(match);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`FakeEngine: timed out after ${timeoutMs}ms waiting for a message`));
      }, timeoutMs);
      const waiter = {
        match,
        resolve: (m: WireMessage) => { clearTimeout(timer); resolve(m); },
      };
      this.waiters.push(waiter);
    });
  }

  /** Wait until the provider has registered itself and the given number of handlers. */
  async waitForRegistration(handlerCount: number): Promise<WireMessage[]> {
    await this.waitFor((m) => m.messageType === 'register_provider');
    const deadline = Date.now() + (this.options.timeoutMs ?? 5000);
    while (this.registrations().length < handlerCount + 1) {
      if (Date.now() > deadline) {
        throw new Error('FakeEngine: timed out waiting for handler registrations');
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.registrations();
  }

  registrations(): WireMessage[] {
    return this.received.filter((m) => m.messageType === 'register_provider' || m.messageType === 'register_handler');
  }

  /** Messages of one type received from the provider. */
  ofType(messageType: string): WireMessage[] {
    return this.received.filter((m) => m.messageType === messageType);
  }

  private onMessage(msg: WireMessage): void {
    this.received.push(msg);
    if (msg.messageType === 'service-proxy-request') {
      const reply = this.options.onServiceProxyRequest?.(msg) ?? { status: 200, body: { echo: msg.request } };
      this.send({
        messageType: 'service-proxy-response',
        requestId: msg.requestId,
        status: reply.status,
        headers: { 'content-type': 'application/json' },
        bodyBase64: reply.body === undefined ? undefined : Buffer.from(JSON.stringify(reply.body)).toString('base64'),
        error: reply.error,
      });
    } else if (msg.messageType === 'engineapi_submit_transactions') {
      const reply = this.options.onSubmitTransactions?.(msg) ?? {
        submissions: (msg.transactions as unknown[]).map((_, i) => ({ id: `submitted-${i}`, position: i })),
      };
      this.send({ messageType: 'engineapi_submit_transactions_result', id: msg.id, ...reply });
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.match(msg)) {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        waiter.resolve(msg);
      }
    }
  }
}
