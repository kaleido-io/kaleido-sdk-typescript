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


import WebSocket, { ClientOptions, WebSocketServer } from 'ws';
import { backOff } from 'exponential-backoff';
import {
  WSMessageType,
  WSHandlerType,
  WSHandlerEnvelope,
  WSHandleTransactions,
  WSHandleTransactionsResult,
  WSEventSourceConfig,
  WSListenerPollResult,
  WSEventProcessorBatchResult,
  WSEventProcessorBatchRequest,
} from '../types/core';
import {
  Handler,
  TransactionHandler,
  EventSource,
  EventProcessor,
} from '../interfaces/handlers';
import { EngineClient } from './engine_client';
import { newLogger } from '../log/logger';
import { getErrorMessage } from '../utils/errors';
import { newError, SDKErrors } from '../i18n/errors';

const log = newLogger('handler_runtime');

/**
 * outbound mode connects to the configured URL via a WebSocket connection
 * inbound mode creates a websocket server and waits for connections
 */
export enum HandlerRuntimeMode {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}
/**
 * Configuration for the handler runtime
 */
export interface HandlerRuntimeConfig {
  // This is the websocket URL of the workflow engine
  url?: string;
  // Provider name is the name of the provider
  providerName: string;
  // Provider metadata is used to identify the provider to the workflow engine
  providerMetadata?: Record<string, string>;
  // Auth token is used to authenticate the client to the workflow engine 
  authToken?: string;
  // Auth header name is used to authenticate the client to the workflow engine   
  authHeaderName?: string;
  // Headers are used to add additional headers to the websocket connection
  headers?: Record<string, string>;
  // Options are used to pass additional options to the websocket connection
  // This is directly from the ws library
  options?: ClientOptions;
  // Reconnect delay is the delay before reconnecting to the workflow engine
  reconnectDelay?: number;
  // Max attempts is the maximum number of attempts to reconnect to the workflow engine
  maxAttempts?: number;
  // Ping interval is the interval between ping messages (default: 30s)
  pingIntervalMs?: number;
  // Pong timeout is the timeout for pong response (default: 10s)
  pongTimeoutMs?: number;
}

/**
 * Internal runtime that manages WebSocket connection and handler lifecycle.
 */
export class HandlerRuntime {
  private ws?: WebSocket;
  // WebSocket server is the server that listens for inbound connections
  private wsServer?: WebSocketServer;
  private config: HandlerRuntimeConfig;
  private mode: HandlerRuntimeMode = HandlerRuntimeMode.OUTBOUND;
  private port?: number;

  private transactionHandlers: Map<string, TransactionHandler> = new Map();
  private eventSources: Map<string, EventSource> = new Map();
  private eventSourceConfigs: Map<string, WSEventSourceConfig> = new Map();
  private eventProcessors: Map<string, EventProcessor> = new Map();

  private reconnectResolve?: (value: void | PromiseLike<void>) => void;
  private reconnectReject?: (reason?: any) => void;
  private isConnected = false;
  private shouldReconnect = true;

  // Heartbeat for connection liveness detection
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;
  private readonly PING_INTERVAL_MS: number;
  private readonly PONG_TIMEOUT_MS: number;

  private engineClient: EngineClient;
  private activeHandlerContext?: { requestId: string; authTokens: Record<string, string> };

  constructor(config: HandlerRuntimeConfig) {
    if (process.env.WORKFLOW_ENGINE_MODE === 'inbound') {
      this.mode = HandlerRuntimeMode.INBOUND;
      if (!process.env.WEBSOCKET_PORT) {
        throw newError(SDKErrors.MsgSDKWebSocketPortRequiredInbound);
      }
      this.port = parseInt(process.env.WEBSOCKET_PORT);
    }
    this.config = config;
    this.engineClient = new EngineClient(this);
    // Set heartbeat intervals from config or use defaults
    this.PING_INTERVAL_MS = config.pingIntervalMs ?? 30000; // 30 seconds default
    this.PONG_TIMEOUT_MS = config.pongTimeoutMs ?? 10000; // 10 seconds default
  }

  /**
   * Register a transaction handler
   */
  registerTransactionHandler(name: string, handler: TransactionHandler): void {
    this.transactionHandlers.set(name, handler);
  }

  /**
   * Register an event source handler
   */
  registerEventSource(name: string, handler: EventSource): void {
    this.eventSources.set(name, handler);
  }

  /**
   * Register an event processor handler
   */
  registerEventProcessor(name: string, handler: EventProcessor): void {
    this.eventProcessors.set(name, handler);
  }

  /**
   * Get all registered handlers
   */
  getAllHandlers(): Handler[] {
    return [
      ...Array.from(this.transactionHandlers.values()),
      ...Array.from(this.eventSources.values()),
      ...Array.from(this.eventProcessors.values()),
    ];
  }

  /**
   * Initialize all handlers and connect to WebSocket
   */
  async start(): Promise<void> {
    if (this.mode === HandlerRuntimeMode.INBOUND) {
      log.info('Starting handler runtime in inbound mode', {
        port: this.port,
        provider: this.config.providerName
      });
    } else {
      log.info('Starting handler runtime in outbound mode and registering with workflow engine at', {
        url: this.config.url,
        provider: this.config.providerName
      });
    }

    // Initialize all handlers
    for (const [name, handler] of this.transactionHandlers.entries()) {
      await handler.init(this.engineClient);
      log.debug('Initialized transaction handler', { name });
    }
    for (const [name, handler] of this.eventSources.entries()) {
      await handler.init(this.engineClient);
      log.debug('Initialized event source', { name });
    }
    for (const [name, handler] of this.eventProcessors.entries()) {
      await handler.init(this.engineClient);
      log.debug('Initialized event processor', { name });
    }

    if (this.mode === HandlerRuntimeMode.INBOUND) {
      this.shouldReconnect = false;
      this.createWebSocketServer();
    } else {
      // Connect to WebSocket with retry
      await this.connectWebSocket();
    }
  }

  /**
   * Stop the runtime and close all handlers
   */
  stop(): void {
    log.info('Stopping handler runtime');

    this.shouldReconnect = false;

    // Clean up heartbeat
    this.cleanupHeartbeat();

    if (this.ws) {
      this.ws.close();
    }

    if (this.wsServer) {
      this.wsServer.close();
    }

    for (const [name, handler] of this.transactionHandlers.entries()) {
      handler.close();
      log.debug('Closed transaction handler', { name });
    }
    for (const [name, handler] of this.eventSources.entries()) {
      handler.close();
      log.debug('Closed event source', { name });
    }
    for (const [name, handler] of this.eventProcessors.entries()) {
      handler.close();
      log.debug('Closed event processor', { name });
    }
  }

  /**
   * Check if connected to the workflow engine
   */
  isWebSocketConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Set active handler context for EngineAPI calls
   */
  setActiveHandlerContext(requestId: string, authTokens: Record<string, string>): void {
    this.activeHandlerContext = { requestId, authTokens };
  }

  /**
   * Clear active handler context
   */
  clearActiveHandlerContext(): void {
    this.activeHandlerContext = undefined;
  }

  /**
   * Get active handler context
   */
  getActiveHandlerContext(): { requestId: string; authTokens: Record<string, string> } | undefined {
    return this.activeHandlerContext;
  }

  /**
   * Send a message over WebSocket
   */
  sendMessage(message: any): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    } else {
      log.warn('Attempted to send message while disconnected');
    }
  }

  // ============================================================================
  // WebSocket Connection Management
  // ============================================================================

  private createWebSocketServer(): void {
    this.wsServer = new WebSocketServer({ port: this.port });
    this.wsServer.on('connection', (ws, req) => {
      log.info('WebSocket server connection', { remoteAddress: req.socket.remoteAddress, remotePort: req.socket.remotePort });
      this.ws = ws;
      this.isConnected = true;
      this.setupHeartbeat();
      this.registerProviderAndHandlers();
      ws.on('error', this.onError.bind(this));
      ws.on('close', this.onClose.bind(this));
      ws.on('message', this.onMessage.bind(this));
    });
  }

  private async connectWebSocket(): Promise<void> {

    return backOff(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!this.config.url) {
            throw newError(SDKErrors.MsgSDKURLRequiredOutbound);
          }
          log.debug('Connecting to WebSocket', { url: this.config.url });

          const wsOptions: ClientOptions = {
            ...this.config.options,
            headers: {
              ...this.config.options?.headers,
              ...this.config.headers,
            },
          };

          if (this.config.authToken) {
            // We can default to Authorization if not set
            const authHeaderName = this.config.authHeaderName ?? 'Authorization';
            wsOptions.headers = {
              ...wsOptions.headers,
              [authHeaderName]: this.config.authToken,
            };
          }

          this.ws = new WebSocket(this.config.url, wsOptions);
          this.reconnectResolve = resolve;
          this.reconnectReject = reject;

          this.ws.on('error', this.onError.bind(this));
          this.ws.on('open', this.onOpen.bind(this));
          this.ws.on('message', this.onMessage.bind(this));
          this.ws.on('close', this.onClose.bind(this));
        }),
      this.config.maxAttempts ? { numOfAttempts: this.config.maxAttempts } : {}
    );
  }

  private onError(error: Error): void {
    log.error('WebSocket error', { error: error.message });
    if (this.reconnectReject) {
      this.reconnectReject(error);
    }
  }

  private onOpen(): void {
    this.isConnected = true;
    log.info('WebSocket connected');

    if (this.reconnectResolve) {
      this.reconnectResolve();
      this.reconnectResolve = undefined;
      this.reconnectReject = undefined;
    }

    // Setup heartbeat for connection liveness detection
    this.setupHeartbeat();

    this.registerProviderAndHandlers();
  }

  private onClose(): void {
    this.isConnected = false;
    log.info('WebSocket closed');

    // Clean up heartbeat
    this.cleanupHeartbeat();

    if (this.reconnectReject) {
      this.reconnectReject(new Error('WebSocket closed'));
      this.reconnectReject = undefined;
      this.reconnectResolve = undefined;
    } else if (this.shouldReconnect) {
      const delay = this.config.reconnectDelay || 1000;
      log.info('Reconnecting', { delay });
      setTimeout(() => this.connectWebSocket(), delay);
    }
  }

  private onMessage(data: any, isBinary: boolean): void {
    try {
      const message = isBinary ? data : data.toString();

      if (typeof message === 'string') {
        const msg = JSON.parse(message);
        this.handleMessage(msg);
      } else {
        log.warn('Received non-string message data, ignoring');
      }
    } catch (error) {
      log.error('Error processing message', { error });
    }
  }

  // ============================================================================
  // Handler Registration
  // ============================================================================

  private registerProviderAndHandlers(): void {
    log.info('Registering provider and handlers', {
      provider: this.config.providerName,
      transactionHandlers: this.transactionHandlers.size,
      eventSources: this.eventSources.size,
      eventProcessors: this.eventProcessors.size
    });

    // Register provider
    this.sendMessage({
      messageType: WSMessageType.REGISTER_PROVIDER,
      id: this.generateId(),
      providerName: this.config.providerName,
      providerMetadata: this.config.providerMetadata,
    });

    // Register all transaction handlers
    for (const name of this.transactionHandlers.keys()) {
      this.registerHandler(name, WSHandlerType.TRANSACTION_HANDLER);
    }

    // Register all event sources
    for (const name of this.eventSources.keys()) {
      this.registerHandler(name, WSHandlerType.EVENT_SOURCE);
    }

    // Register all event processors
    for (const name of this.eventProcessors.keys()) {
      this.registerHandler(name, WSHandlerType.EVENT_PROCESSOR);
    }
  }

  private registerHandler(handlerName: string, handlerType: WSHandlerType): void {
    log.debug('Registering handler', { name: handlerName, type: handlerType });

    this.sendMessage({
      messageType: WSMessageType.REGISTER_HANDLER,
      id: this.generateId(),
      handlerType: handlerType,
      handler: handlerName,
    });
  }

  // ============================================================================
  // Message Routing
  // ============================================================================

  private handleMessage(msg: any): void {
    switch (msg.messageType) {
      case WSMessageType.HANDLE_TRANSACTIONS:
        this.handleTransactionsMessage(msg as WSHandleTransactions);
        break;
      case WSMessageType.EVENT_PROCESSOR_BATCH:
        this.handleEventProcessorBatch(msg as WSEventProcessorBatchRequest);
        break;
      case WSMessageType.EVENT_SOURCE_CONFIG:
        this.handleEventSourceConfig(msg as WSEventSourceConfig);
        break;
      case WSMessageType.EVENT_SOURCE_POLL:
        this.handleEventSourcePoll(msg);
        break;
      case WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG:
        this.handleEventSourceValidateConfig(msg);
        break;
      case WSMessageType.EVENT_SOURCE_DELETE:
        this.handleEventSourceDelete(msg);
        break;
      case WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS_RESULT:
        this.engineClient.handleResponse(msg);
        break;
      case WSMessageType.PROTOCOL_ERROR:
        log.error('Protocol error received', { error: msg.error });
        break;
      case WSMessageType.REGISTER_PROVIDER:
      case WSMessageType.REGISTER_HANDLER:
        log.debug('Registration response', { messageType: msg.messageType });
        break;
      default:
        log.warn('Unknown message type', { messageType: msg.messageType });
    }
  }

  private async handleTransactionsMessage(batch: WSHandleTransactions): Promise<void> {
    if (!batch.handler) {
      log.error('Handler not set in transactions message');
      return;
    }

    log.debug('Handling transactions', {
      handler: batch.handler,
      batchId: batch.id,
      count: batch.transactions.length
    });

    const response: WSHandleTransactionsResult = {
      messageType: WSMessageType.HANDLE_TRANSACTIONS_RESULT,
      handler: batch.handler,
      id: batch.id,
      results: [],
    };

    try {
      const handler = this.transactionHandlers.get(batch.handler);
      if (handler) {
        this.setActiveHandlerContext(batch.id, batch.authTokens || {});
        await handler.transactionHandlerBatch(response, batch);
      } else {
        response.error = `No transaction handler registered: ${batch.handler}`;
        log.error(response.error);
      }
    } catch (error) {
      log.error('Handler failed', { handler: batch.handler, error });
      response.results = batch.transactions.map(() => ({
        error: getErrorMessage(error)
      }));
    } finally {
      this.clearActiveHandlerContext();
    }

    this.sendMessage(response);
  }

  private async handleEventProcessorBatch(batch: WSEventProcessorBatchRequest): Promise<void> {
    log.debug('Handling event processor batch', {
      handler: batch.handler,
      batchId: batch.id,
      count: batch.events.length
    });

    const response: WSEventProcessorBatchResult = {
      messageType: WSMessageType.EVENT_PROCESSOR_BATCH_RESULT,
      id: batch.id,
      handler: batch.handler,
      events: batch.events,
    };
    try {
      const eventProcessor = this.eventProcessors.get(batch.handler || '');
      if (eventProcessor) {
        this.setActiveHandlerContext(batch.id, batch.authTokens || {});
        await eventProcessor.eventProcessorBatch(response as any, batch as any);
      } else {
        response.error = `No event processor registered: ${batch.handler}`;
        log.error(response.error);
      }
    } catch (error) {
      log.error('Event processor batch failed', { handler: batch.handler, error });
      response.error = getErrorMessage(error);
    } finally {
      this.clearActiveHandlerContext();
    }

    this.sendMessage(response);
  }

  private async handleEventSourceConfig(config: WSEventSourceConfig): Promise<void> {
    log.debug('Event source config', {
      stream: config.streamId,
      name: config.streamName
    });

    // Store the config for later use during polling
    this.eventSourceConfigs.set(config.streamId, config);
  }

  private async handleEventSourcePoll(request: any): Promise<void> {

    const response: WSListenerPollResult = {
      messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT,
      id: request.id,
      handler: request.handler,
      events: [],
    };

    try {
      const eventSource = this.eventSources.get(request.handler || '');
      const config = this.eventSourceConfigs.get(request.streamId);

      if (eventSource && config) {
        this.setActiveHandlerContext(request.id, request.authTokens || {});
        await eventSource.eventSourcePoll(config, response, request);
      } else {
        response.error = `No event source or config: ${request.handler}/${request.streamId}`;
        log.error(response.error);
      }
    } catch (error) {
      log.error('Event source poll failed', { handler: request.handler, error });
      response.error = getErrorMessage(error);
    } finally {
      this.clearActiveHandlerContext();
    }

    this.sendMessage(response);
  }

  private async handleEventSourceValidateConfig(request: any): Promise<void> {
    log.debug('Event source validate config', { handler: request.handler });

    const response: WSHandlerEnvelope = {
      messageType: WSMessageType.EVENT_SOURCE_VALIDATE_CONFIG_RESULT,
      id: request.id,
      handler: request.handler,
    };

    try {
      const eventSource = this.eventSources.get(request.handler || '');
      if (eventSource) {
        this.setActiveHandlerContext(request.id, request.authTokens || {});
        await eventSource.eventSourceValidateConfig(response, request);
      } else {
        response.error = `No event source registered: ${request.handler}`;
        log.error(response.error);
      }
    } catch (error) {
      log.error('Event source validate config failed', {
        handler: request.handler,
        error
      });
      response.error = getErrorMessage(error);
    } finally {
      this.clearActiveHandlerContext();
    }

    this.sendMessage(response);
  }

  private async handleEventSourceDelete(request: any): Promise<void> {
    log.debug('Event source delete', {
      handler: request.handler,
      stream: request.streamId
    });

    const response: WSHandlerEnvelope = {
      messageType: WSMessageType.EVENT_SOURCE_DELETE_RESULT,
      id: request.id,
      handler: request.handler,
    };

    try {
      const eventSource = this.eventSources.get(request.handler || '');
      if (eventSource) {
        this.setActiveHandlerContext(request.id, request.authTokens || {});
        await eventSource.eventSourceDelete(response, request);
        this.eventSourceConfigs.delete(request.streamId);
      } else {
        response.error = `No event source registered: ${request.handler}`;
        log.error(response.error);
      }
    } catch (error) {
      log.error('Event source delete failed', { handler: request.handler, error });
      response.error = getErrorMessage(error);
    } finally {
      this.clearActiveHandlerContext();
    }

    this.sendMessage(response);
  }

  // ============================================================================
  // WebSocket Heartbeat (Ping/Pong)
  // ============================================================================

  /**
   * Setup WebSocket heartbeat for connection liveness detection.
   * Sends periodic pings and detects missing pongs to identify dead connections.
   */
  private setupHeartbeat(): void {
    if (!this.ws) {
      return;
    }

    log.debug('Setting up WebSocket heartbeat', {
      pingInterval: this.PING_INTERVAL_MS,
      pongTimeout: this.PONG_TIMEOUT_MS
    });

    // Send ping every PING_INTERVAL_MS
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isConnected) {
        this.ws.ping();

        // Expect pong within PONG_TIMEOUT_MS
        clearTimeout(this.pongTimeout);
        this.pongTimeout = setTimeout(() => {
          log.warn('Pong timeout - connection appears dead, reconnecting');
          this.ws?.terminate();
          // onClose will trigger reconnection
        }, this.PONG_TIMEOUT_MS);
      }
    }, this.PING_INTERVAL_MS);

    // Listen for pong responses
    this.ws.on('pong', () => {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = undefined;
      }
    });

    // Respond to server pings (ws library handles this automatically, but we log it)
    this.ws.on('ping', () => {
      log.debug('Received WebSocket ping from server');
    });
  }

  /**
   * Cleanup heartbeat timers and handlers
   */
  private cleanupHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
      log.debug('Cleared ping interval');
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
      log.debug('Cleared pong timeout');
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

