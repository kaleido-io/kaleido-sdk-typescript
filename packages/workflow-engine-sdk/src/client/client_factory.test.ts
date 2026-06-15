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
import { handlerSetFor, createWorkflowEngineClient } from './client_factory';
import { WorkflowEngineClient, WorkflowEngineClientConfig } from './client';
import {
  TransactionHandler,
  EventSource,
  EventProcessor,
} from '../interfaces/handlers';

jest.mock('./client');
jest.mock('../config/config', () => ({
  ConfigLoader: {
    loadClientConfigFromFile: jest.fn(),
    loadServiceBindings: jest.fn().mockReturnValue({}),
  },
}));

const { ConfigLoader } = jest.requireMock('../config/config') as {
  ConfigLoader: {
    loadClientConfigFromFile: jest.Mock;
    loadServiceBindings: jest.Mock;
  };
};

const mockClientConfig: WorkflowEngineClientConfig = {
  url: 'ws://localhost:5503/ws',
  providerName: 'test-provider',
};

function createMockTransactionHandler(name: string): TransactionHandler {
  return {
    name,
    init: jest.fn(),
    close: jest.fn(),
    transactionHandlerBatch: jest.fn(),
  } as unknown as TransactionHandler;
}

function createMockEventSource(name: string): EventSource {
  return {
    name,
    init: jest.fn(),
    close: jest.fn(),
    eventSourcePoll: jest.fn(),
    eventSourceValidateConfig: jest.fn(),
    eventSourceDelete: jest.fn(),
  } as unknown as EventSource;
}

function createMockEventProcessor(name: string): EventProcessor {
  return {
    name,
    init: jest.fn(),
    close: jest.fn(),
    eventProcessorBatch: jest.fn(),
  } as unknown as EventProcessor;
}

describe('client_factory', () => {
  let mockConnect: jest.Mock;
  let mockRegisterTransactionHandler: jest.Mock;
  let mockRegisterEventSource: jest.Mock;
  let mockRegisterEventProcessor: jest.Mock;
  let mockClient: jest.Mocked<WorkflowEngineClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect = jest.fn().mockImplementation(() => Promise.resolve());
    mockRegisterTransactionHandler = jest.fn();
    mockRegisterEventSource = jest.fn();
    mockRegisterEventProcessor = jest.fn();
    mockClient = {
      registerTransactionHandler: mockRegisterTransactionHandler,
      registerEventSource: mockRegisterEventSource,
      registerEventProcessor: mockRegisterEventProcessor,
      connect: mockConnect,
    } as unknown as jest.Mocked<WorkflowEngineClient>;

    (
      WorkflowEngineClient as jest.MockedClass<typeof WorkflowEngineClient>
    ).mockImplementation(() => mockClient);
    ConfigLoader.loadClientConfigFromFile.mockReturnValue(mockClientConfig);
  });

  describe('handlerSetFor', () => {
    it('should return the same array of handlers', () => {
      const tx = createMockTransactionHandler('tx1');
      const es = createMockEventSource('es1');
      const set = handlerSetFor(tx, es);
      expect(set).toEqual([tx, es]);
      expect(set).toHaveLength(2);
    });

    it('should return empty array when no handlers passed', () => {
      const set = handlerSetFor();
      expect(set).toEqual([]);
    });

    it('should return single handler in array', () => {
      const ep = createMockEventProcessor('echo');
      const set = handlerSetFor(ep);
      expect(set).toHaveLength(1);
      expect(set[0]).toBe(ep);
    });
  });

  describe('createWorkflowEngineClient', () => {
    it('should load config from file and create connected client', async () => {
      const tx = createMockTransactionHandler('my-tx');
      const set = handlerSetFor(tx);

      const client = await createWorkflowEngineClient(set, '/path/to/wfe.yaml');

      expect(ConfigLoader.loadClientConfigFromFile).toHaveBeenCalledWith(
        '/path/to/wfe.yaml',
      );
      expect(WorkflowEngineClient).toHaveBeenCalledWith(mockClientConfig);
      expect(mockRegisterTransactionHandler).toHaveBeenCalledWith('my-tx', tx);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(client).toBe(mockClient);
    });

    it('should register event source by name from handler', async () => {
      const es = createMockEventSource('my-listener');
      const set = handlerSetFor(es);

      await createWorkflowEngineClient(set, '/wfe.yaml');

      expect(mockRegisterEventSource).toHaveBeenCalledWith('my-listener', es);
      expect(mockRegisterTransactionHandler).not.toHaveBeenCalled();
      expect(mockRegisterEventProcessor).not.toHaveBeenCalled();
    });

    it('should register event processor by name from handler', async () => {
      const ep = createMockEventProcessor('echo');
      const set = handlerSetFor(ep);

      await createWorkflowEngineClient(set, '/wfe.yaml');

      expect(mockRegisterEventProcessor).toHaveBeenCalledWith('echo', ep);
      expect(mockRegisterTransactionHandler).not.toHaveBeenCalled();
      expect(mockRegisterEventSource).not.toHaveBeenCalled();
    });

    it('should register multiple handlers of different types', async () => {
      const tx = createMockTransactionHandler('tx1');
      const es = createMockEventSource('source1');
      const ep = createMockEventProcessor('processor1');
      const set = handlerSetFor(tx, es, ep);

      await createWorkflowEngineClient(set, '/wfe.yaml');

      expect(mockRegisterTransactionHandler).toHaveBeenCalledWith('tx1', tx);
      expect(mockRegisterEventSource).toHaveBeenCalledWith('source1', es);
      expect(mockRegisterEventProcessor).toHaveBeenCalledWith('processor1', ep);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should call loadClientConfigFromFile with undefined when configFile omitted', async () => {
      const set = handlerSetFor(createMockTransactionHandler('tx'));

      await createWorkflowEngineClient(set);

      expect(ConfigLoader.loadClientConfigFromFile).toHaveBeenCalledWith(
        undefined,
      );
    });

    it('should throw when handler is not transaction, event source, or event processor', async () => {
      const invalidHandler = {
        name: 'invalid',
        init: jest.fn(),
        close: jest.fn(),
      };
      const set = handlerSetFor(invalidHandler as any);

      await expect(createWorkflowEngineClient(set, '/wfe.yaml')).rejects.toThrow(
        /Handler "invalid" does not implement TransactionHandler/,
      );
    });

    it('should propagate error when loadClientConfigFromFile throws', async () => {
      ConfigLoader.loadClientConfigFromFile.mockImplementation(() => {
        throw new Error('Config file not found');
      });
      const set = handlerSetFor(createMockTransactionHandler('tx'));

      await expect(
        createWorkflowEngineClient(set, '/missing.yaml'),
      ).rejects.toThrow('Config file not found');
      expect(WorkflowEngineClient).not.toHaveBeenCalled();
    });
  });
});
