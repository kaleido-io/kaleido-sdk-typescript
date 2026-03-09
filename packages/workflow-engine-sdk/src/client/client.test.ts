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


import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WorkflowEngineClient, WorkflowEngineClientConfig } from './client';
import { HandlerRuntime } from '../runtime/handler_runtime';
import { TransactionHandler, EventSource, EventProcessor } from '../interfaces/handlers';

jest.mock('../runtime/handler_runtime');

describe('WorkflowEngineClient', () => {
  let mockRuntime: jest.Mocked<HandlerRuntime>;
  let mockRegisterTransactionHandler: jest.Mock;
  let mockRegisterEventSource: jest.Mock;
  let mockRegisterEventProcessor: jest.Mock;
  let mockStart: jest.Mock<() => Promise<void>>;
  let mockStop: jest.Mock<() => void>;
  let mockIsWebSocketConnected: jest.Mock<() => boolean>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock methods
    mockRegisterTransactionHandler = jest.fn();
    mockRegisterEventSource = jest.fn();
    mockRegisterEventProcessor = jest.fn();
    mockStart = jest.fn();
    mockStop = jest.fn();
    mockIsWebSocketConnected = jest.fn();

    // Create mock runtime instance
    mockRuntime = {
      registerTransactionHandler: mockRegisterTransactionHandler,
      registerEventSource: mockRegisterEventSource,
      registerEventProcessor: mockRegisterEventProcessor,
      start: mockStart,
      stop: mockStop,
      isWebSocketConnected: mockIsWebSocketConnected,
    } as any as jest.Mocked<HandlerRuntime>;

    // Mock the HandlerRuntime constructor
    (HandlerRuntime as jest.MockedClass<typeof HandlerRuntime>).mockImplementation(() => {
      return mockRuntime;
    });
  });

  describe('constructor', () => {
    it('should create HandlerRuntime', () => {
      const config: WorkflowEngineClientConfig = {
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization',
      };

      new WorkflowEngineClient(config);

      expect(HandlerRuntime).toHaveBeenCalledTimes(1);
      expect(HandlerRuntime).toHaveBeenCalledWith({
        mode: undefined,
        port: undefined,
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
        providerMetadata: undefined,
        authToken: 'test-token',
        authHeaderName: 'Authorization',
        headers: undefined,
        options: undefined,
        reconnectDelay: undefined,
        maxAttempts: undefined,
      });
    });

    it('should create HandlerRuntime with correct config for inbound mode', () => {
      process.env.WORKFLOW_ENGINE_MODE = 'inbound';
      process.env.WEBSOCKET_PORT = '5000';
      const config: WorkflowEngineClientConfig = {
        providerName: 'test-provider',
        providerMetadata: { version: '1.0.0' },
        reconnectDelay: 2000,
        maxAttempts: 5,
      };

      new WorkflowEngineClient(config);

      expect(HandlerRuntime).toHaveBeenCalledWith({
        providerName: 'test-provider',
        providerMetadata: { version: '1.0.0' },
        reconnectDelay: 2000,
        maxAttempts: 5,
      });
      delete process.env.WORKFLOW_ENGINE_MODE;
      delete process.env.WEBSOCKET_PORT;
    });

    it('should create HandlerRuntime with all optional config fields', () => {
      const config: WorkflowEngineClientConfig = {
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization',
        headers: { 'Custom-Header': 'value' },
        options: { perMessageDeflate: false },
        providerMetadata: { key: 'value' },
        reconnectDelay: 3000,
        maxAttempts: 10,
      };

      new WorkflowEngineClient(config);

      expect(HandlerRuntime).toHaveBeenCalledWith({
        mode: undefined,
        port: undefined,
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
        providerMetadata: { key: 'value' },
        authToken: 'test-token',
        authHeaderName: 'Authorization',
        headers: { 'Custom-Header': 'value' },
        options: { perMessageDeflate: false },
        reconnectDelay: 3000,
        maxAttempts: 10,
      });
    });
  });

  describe('registerTransactionHandler', () => {
    it('should delegate to runtime.registerTransactionHandler', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const mockHandler: TransactionHandler = {
        name: () => 'test-handler',
        init: jest.fn(),
        close: jest.fn(),
      } as any;

      client.registerTransactionHandler('handler-name', mockHandler);

      expect(mockRegisterTransactionHandler).toHaveBeenCalledTimes(1);
      expect(mockRegisterTransactionHandler).toHaveBeenCalledWith('handler-name', mockHandler);
    });

    it('should allow registering multiple handlers', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const handler1: TransactionHandler = {
        name: () => 'handler1',
        init: jest.fn(),
        close: jest.fn(),
      } as any;

      const handler2: TransactionHandler = {
        name: () => 'handler2',
        init: jest.fn(),
        close: jest.fn(),
      } as any;

      client.registerTransactionHandler('handler1', handler1);
      client.registerTransactionHandler('handler2', handler2);

      expect(mockRegisterTransactionHandler).toHaveBeenCalledTimes(2);
      expect(mockRegisterTransactionHandler).toHaveBeenNthCalledWith(1, 'handler1', handler1);
      expect(mockRegisterTransactionHandler).toHaveBeenNthCalledWith(2, 'handler2', handler2);
    });
  });

  describe('registerEventSource', () => {
    it('should delegate to runtime.registerEventSource', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const mockEventSource: EventSource = {
        name: () => 'test-source',
        init: jest.fn(),
        close: jest.fn(),
        eventSourcePoll: jest.fn(),
        eventSourceValidateConfig: jest.fn(),
        eventSourceDelete: jest.fn(),
      } as any;

      client.registerEventSource('source-name', mockEventSource);

      expect(mockRegisterEventSource).toHaveBeenCalledTimes(1);
      expect(mockRegisterEventSource).toHaveBeenCalledWith('source-name', mockEventSource);
    });

    it('should allow registering multiple event sources', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const source1: EventSource = {
        name: () => 'source1',
        init: jest.fn(),
        close: jest.fn(),
        eventSourcePoll: jest.fn(),
        eventSourceValidateConfig: jest.fn(),
        eventSourceDelete: jest.fn(),
      } as any;

      const source2: EventSource = {
        name: () => 'source2',
        init: jest.fn(),
        close: jest.fn(),
        eventSourcePoll: jest.fn(),
        eventSourceValidateConfig: jest.fn(),
        eventSourceDelete: jest.fn(),
      } as any;

      client.registerEventSource('source1', source1);
      client.registerEventSource('source2', source2);

      expect(mockRegisterEventSource).toHaveBeenCalledTimes(2);
      expect(mockRegisterEventSource).toHaveBeenNthCalledWith(1, 'source1', source1);
      expect(mockRegisterEventSource).toHaveBeenNthCalledWith(2, 'source2', source2);
    });
  });

  describe('registerEventProcessor', () => {
    it('should delegate to runtime.registerEventProcessor', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const mockEventProcessor: EventProcessor = {
        name: () => 'test-processor',
        init: jest.fn(),
        close: jest.fn(),
        eventProcessorBatch: jest.fn(),
      } as any;

      client.registerEventProcessor('test-processor', mockEventProcessor);

      expect(mockRegisterEventProcessor).toHaveBeenCalledTimes(1);
      expect(mockRegisterEventProcessor).toHaveBeenCalledWith('test-processor', mockEventProcessor);
    });

    it('should allow registering multiple event processors', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const processor1: EventProcessor = {
        name: () => 'processor1',
        init: jest.fn(),
        close: jest.fn(),
        eventProcessorBatch: jest.fn(),
      } as any;

      const processor2: EventProcessor = {
        name: () => 'processor2',
        init: jest.fn(),
        close: jest.fn(),
        eventProcessorBatch: jest.fn(),
      } as any;

      client.registerEventProcessor('processor1', processor1);
      client.registerEventProcessor('processor2', processor2);

      expect(mockRegisterEventProcessor).toHaveBeenCalledTimes(2);
      expect(mockRegisterEventProcessor).toHaveBeenNthCalledWith(1, 'processor1', processor1);
      expect(mockRegisterEventProcessor).toHaveBeenNthCalledWith(2, 'processor2', processor2);
    });
  });

  describe('connect', () => {
    it('should delegate to runtime.start', async () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      await client.connect();

      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledWith();
    });

    it('should handle runtime.start errors', async () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const error = new Error('Connection failed');
      mockStart.mockRejectedValueOnce(error);

      await expect(client.connect()).rejects.toThrow('Connection failed');
      expect(mockStart).toHaveBeenCalledTimes(1);
    });

    it('should resolve when runtime.start succeeds', async () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      mockStart.mockResolvedValueOnce(undefined);

      await expect(client.connect()).resolves.toBeUndefined();
      expect(mockStart).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('should delegate to runtime.stop', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      client.disconnect();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockStop).toHaveBeenCalledWith();
    });

    it('should allow multiple disconnect calls', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      client.disconnect();
      client.disconnect();

      expect(mockStop).toHaveBeenCalledTimes(2);
    });
  });

  describe('close', () => {
    it('should call disconnect', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      client.close();

      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      client.close();
      client.close();

      expect(mockStop).toHaveBeenCalledTimes(2);
    });
  });

  describe('isConnected', () => {
    it('should delegate to runtime.isWebSocketConnected', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      mockIsWebSocketConnected.mockReturnValueOnce(true);
      expect(client.isConnected()).toBe(true);
      expect(mockIsWebSocketConnected).toHaveBeenCalledTimes(1);

      mockIsWebSocketConnected.mockReturnValueOnce(false);
      expect(client.isConnected()).toBe(false);
      expect(mockIsWebSocketConnected).toHaveBeenCalledTimes(2);
    });

    it('should reflect connection state changes', () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      mockIsWebSocketConnected.mockReturnValueOnce(false);
      expect(client.isConnected()).toBe(false);

      mockIsWebSocketConnected.mockReturnValueOnce(true);
      expect(client.isConnected()).toBe(true);

      mockIsWebSocketConnected.mockReturnValueOnce(false);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full lifecycle: register handlers, connect, check status, disconnect', async () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
      });

      const handler: TransactionHandler = {
        name: () => 'test-handler',
        init: jest.fn(),
        close: jest.fn(),
      } as any;

      const eventSource: EventSource = {
        name: () => 'test-source',
        init: jest.fn(),
        close: jest.fn(),
        eventSourcePoll: jest.fn(),
        eventSourceValidateConfig: jest.fn(),
        eventSourceDelete: jest.fn(),
      } as any;

      // Register handlers
      client.registerTransactionHandler('handler', handler);
      client.registerEventSource('source', eventSource);

      // Initially not connected
      mockIsWebSocketConnected.mockReturnValueOnce(false);
      expect(client.isConnected()).toBe(false);

      // Connect
      await client.connect();
      expect(mockStart).toHaveBeenCalledTimes(1);

      // Check connection status
      mockIsWebSocketConnected.mockReturnValueOnce(true);
      expect(client.isConnected()).toBe(true);

      // Disconnect
      client.disconnect();
      expect(mockStop).toHaveBeenCalledTimes(1);

      // Verify all interactions
      expect(mockRegisterTransactionHandler).toHaveBeenCalledWith('handler', handler);
      expect(mockRegisterEventSource).toHaveBeenCalledWith('source', eventSource);
    });

    it('should handle reconnection scenario', async () => {
      const client = new WorkflowEngineClient({
        url: 'ws://localhost:5503/ws',
        providerName: 'test-provider',
        reconnectDelay: 2000,
        maxAttempts: 3,
      });

      // First connection attempt fails
      mockStart.mockRejectedValueOnce(new Error('Connection failed'));
      await expect(client.connect()).rejects.toThrow('Connection failed');

      // Second attempt succeeds
      mockStart.mockResolvedValueOnce(undefined);
      await client.connect();

      expect(mockStart).toHaveBeenCalledTimes(2);
    });
  });
});
