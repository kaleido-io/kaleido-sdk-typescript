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
import {
  WorkflowEngineRestClient,
  CreateWorkflowRequest,
  CreateTransactionRequest,
  CreateStreamRequest,
} from './rest-client';
import { WorkflowEngineClientConfig } from './client';

/**
 * Helper function to create mock Response objects for testing
 */
function createMockResponse({
  ok,
  status,
  statusText,
  json,
  text,
}: {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}): Response {
  return {
    ok,
    status,
    statusText: statusText || 'OK',
    json: json || (async () => ({})),
    text: text || (async () => ''),
    headers: new Headers(),
    redirected: false,
    type: 'default',
    url: '',
    clone: jest.fn(),
    arrayBuffer: jest.fn(),
    blob: jest.fn(),
    formData: jest.fn(),
    body: null,
    bodyUsed: false,
  } as unknown as Response;
}

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('WorkflowEngineRestClient', () => {
  let client: WorkflowEngineRestClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    // Clear environment variables
    delete process.env.ACCOUNT;
    delete process.env.ENVIRONMENT;
    delete process.env.WORKFLOW_ENGINE;
    delete process.env.KEY_NAME;
    delete process.env.KEY_VALUE;
  });

  describe('constructor', () => {
    it('should create client with explicit config', () => {
      const config: WorkflowEngineClientConfig = {
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      };

      client = new WorkflowEngineRestClient(config);

      expect(client).toBeInstanceOf(WorkflowEngineRestClient);
      expect(client.getWorkflowsEndpoint()).toBe('https://test.example.com/rest/api/v1/workflows');
    });
    it('should handle non-SSL URLs', () => {
      const config: WorkflowEngineClientConfig = {
        url: 'ws://test.example.com/rest/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      };

      client = new WorkflowEngineRestClient(config);

      expect(client).toBeInstanceOf(WorkflowEngineRestClient);
      expect(client.getWorkflowsEndpoint()).toBe('http://test.example.com/rest/api/v1/workflows');
    });
    it('should handle missing rest segments', () => {
      const config: WorkflowEngineClientConfig = {
        url: 'http://test.example.com',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      };

      client = new WorkflowEngineRestClient(config);

      expect(client).toBeInstanceOf(WorkflowEngineRestClient);
      expect(client.getWorkflowsEndpoint()).toBe('http://test.example.com/rest/api/v1/workflows');
    });

    it('should create client from environment variables', () => {
      process.env.ACCOUNT = 'test-account';
      process.env.ENVIRONMENT = 'test-env';
      process.env.WORKFLOW_ENGINE = 'test-engine';
      process.env.KEY_NAME = 'env-key';
      process.env.KEY_VALUE = 'env-value';

      client = new WorkflowEngineRestClient();

      expect(client).toBeInstanceOf(WorkflowEngineRestClient);
    });

    it('should throw error if baseUrl and ACCOUNT are not provided', () => {
      expect(() => {
        new WorkflowEngineRestClient();
      }).toThrow('KA140632: ACCOUNT is not set and no baseUrl provided');
    });

    it('should throw error if baseUrl and ENVIRONMENT are not provided', () => {
      process.env.ACCOUNT = 'test-account';

      expect(() => {
        new WorkflowEngineRestClient();
      }).toThrow('KA140633: ENVIRONMENT is not set and no baseUrl provided');
    });

    it('should throw error if baseUrl and WORKFLOW_ENGINE are not provided', () => {
      process.env.ACCOUNT = 'test-account';
      process.env.ENVIRONMENT = 'test-env';

      expect(() => {
        new WorkflowEngineRestClient();
      }).toThrow('KA140634: WORKFLOW_ENGINE is not set and no baseUrl provided');
    });

    it('should prefer explicit config over environment variables', () => {
      process.env.ACCOUNT = 'env-account';
      process.env.ENVIRONMENT = 'env-env';
      process.env.WORKFLOW_ENGINE = 'env-engine';
      process.env.KEY_NAME = 'env-key';
      process.env.KEY_VALUE = 'env-value';

      const config: WorkflowEngineClientConfig = {
        url: 'wss://explicit.example.com/rest/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      };

      client = new WorkflowEngineRestClient(config);
      expect(client).toBeInstanceOf(WorkflowEngineRestClient);
    });
  });

  describe('createWorkflow', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should create a workflow successfully', async () => {
      const workflowRequest: CreateWorkflowRequest = {
        name: 'test-workflow',
        description: 'Test workflow description',
      };

      const mockResponse = {
        id: 'workflow-123',
        name: 'test-workflow',
        description: 'Test workflow description',
        created: '2025-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => mockResponse,
        })
      );

      const result = await client.createWorkflow(workflowRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/workflows',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'accept': 'application/json',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(workflowRequest),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include timeout in headers when provided', async () => {
      const workflowRequest: CreateWorkflowRequest = {
        name: 'test-workflow',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => ({ id: 'workflow-123' }),
        })
      );

      await client.createWorkflow(workflowRequest, 60);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Request-Timeout': '60m0s',
          }),
        })
      );
    });

    it('should include authorization header when credentials are provided', async () => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      });

      const workflowRequest: CreateWorkflowRequest = {
        name: 'test-workflow',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => ({ id: 'workflow-123' }),
        })
      );

      await client.createWorkflow(workflowRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'test-token',
          }),
        })
      );
    });

    it('should throw error on failed request', async () => {
      const workflowRequest: CreateWorkflowRequest = {
        name: 'test-workflow',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid workflow definition',
        })
      );

      await expect(client.createWorkflow(workflowRequest)).rejects.toThrow(
        'Failed to POST'
      );
    });
  });

  describe('deleteWorkflow', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should delete a workflow successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteWorkflow('workflow-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/workflows/workflow-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should URL encode workflow name or ID', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteWorkflow('workflow with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/workflows/workflow%20with%20spaces',
        expect.any(Object)
      );
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Workflow not found',
        })
      );

      await expect(client.deleteWorkflow('nonexistent')).rejects.toThrow(
        'Failed to DELETE'
      );
    });
  });

  describe('createTransaction', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should create a transaction successfully', async () => {
      const transactionRequest: CreateTransactionRequest = {
        workflow: 'test-workflow',
        operation: 'test-operation',
        input: { key: 'value' },
        idempotencyKey: 'test-key-123',
      };

      const mockResponse = {
        id: 'transaction-123',
        idempotencyKey: 'test-key-123',
        position: 1,
        preexisting: false,
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        })
      );

      const result = await client.createTransaction(transactionRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/transactions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(transactionRequest),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include timeout in headers when provided', async () => {
      const transactionRequest: CreateTransactionRequest = {
        workflow: 'test-workflow',
        operation: 'test-operation',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => ({ idempotencyKey: 'key-123' }),
        })
      );

      await client.createTransaction(transactionRequest, 180);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Request-Timeout': '180m0s',
          }),
        })
      );
    });

    it('should throw error on failed request', async () => {
      const transactionRequest: CreateTransactionRequest = {
        workflow: 'nonexistent',
        operation: 'test-operation',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Workflow not found',
        })
      );

      await expect(client.createTransaction(transactionRequest)).rejects.toThrow(
        'Failed to POST'
      );
    });
  });

  describe('deleteTransaction', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should delete a transaction successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteTransaction('transaction-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/transactions/transaction-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should URL encode transaction ID or key', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteTransaction('key with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/transactions/key%20with%20spaces',
        expect.any(Object)
      );
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Transaction not found',
        })
      );

      await expect(client.deleteTransaction('nonexistent')).rejects.toThrow(
        'Failed to DELETE'
      );
    });
  });

  describe('createStream', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should create a stream successfully', async () => {
      const streamRequest: CreateStreamRequest = {
        name: 'test-stream',
        type: 'event_stream',
        started: true,
      };

      const mockResponse = {
        id: 'stream-123',
        name: 'test-stream',
        type: 'event_stream',
        started: true,
        created: '2025-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => mockResponse,
        })
      );

      const result = await client.createStream(streamRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(streamRequest),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create a correlation stream', async () => {
      const streamRequest: CreateStreamRequest = {
        name: 'correlation-stream',
        type: 'correlation_stream',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => ({ id: 'stream-123' }),
        })
      );

      await client.createStream(streamRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(streamRequest),
        })
      );
    });

    it('should create a transaction dispatch stream', async () => {
      const streamRequest: CreateStreamRequest = {
        name: 'dispatch-stream',
        type: 'transaction_dispatch',
        transactionTemplate: {
          workflow: 'test-workflow',
          operation: 'test-operation',
        },
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 201,
          json: async () => ({ id: 'stream-123' }),
        })
      );

      await client.createStream(streamRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(streamRequest),
        })
      );
    });

    it('should throw error on failed request', async () => {
      const streamRequest: CreateStreamRequest = {
        name: 'test-stream',
        type: 'event_stream',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid stream configuration',
        })
      );

      await expect(client.createStream(streamRequest)).rejects.toThrow(
        'Failed to POST'
      );
    });
  });

  describe('deleteStream', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should delete a stream successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteStream('stream-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams/stream-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should include force parameter when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteStream('stream-123', true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams/stream-123?force=true',
        expect.any(Object)
      );
    });

    it('should URL encode stream name or ID', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 204,
          json: async () => undefined,
        })
      );

      await client.deleteStream('stream with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams/stream%20with%20spaces',
        expect.any(Object)
      );
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Stream not found',
        })
      );

      await expect(client.deleteStream('nonexistent')).rejects.toThrow(
        'Failed to DELETE'
      );
    });
  });

  describe('startStream', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should start a stream successfully', async () => {
      const mockResponse = {
        id: 'stream-123',
        name: 'test-stream',
        started: true,
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        })
      );

      const result = await client.startStream('stream-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams/stream-123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ started: true }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include timeout in headers when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => ({ id: 'stream-123', started: true }),
        })
      );

      await client.startStream('stream-123', 60);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Request-Timeout': '60m0s',
          }),
        })
      );
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Stream not found',
        })
      );

      await expect(client.startStream('nonexistent')).rejects.toThrow(
        'Failed to PATCH'
      );
    });
  });

  describe('stopStream', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
      });
    });

    it('should stop a stream successfully', async () => {
      const mockResponse = {
        id: 'stream-123',
        name: 'test-stream',
        started: false,
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        })
      );

      const result = await client.stopStream('stream-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/rest/api/v1/streams/stream-123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ started: false }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include timeout in headers when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          status: 200,
          json: async () => ({ id: 'stream-123', started: false }),
        })
      );

      await client.stopStream('stream-123', 60);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Request-Timeout': '60m0s',
          }),
        })
      );
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Stream not found',
        })
      );

      await expect(client.stopStream('nonexistent')).rejects.toThrow(
        'Failed to PATCH'
      );
    });
  });

  describe('integration scenarios', () => {
    beforeEach(() => {
      client = new WorkflowEngineRestClient({
        url: 'wss://test.example.com/rest/ws',
        providerName: 'test-provider',
        authToken: 'test-token',
        authHeaderName: 'Authorization'
      });
    });

    it('should handle full workflow lifecycle', async () => {
      const workflowRequest: CreateWorkflowRequest = {
        name: 'test-workflow',
        description: 'Test workflow',
      };

      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 201,
            json: async () => ({ id: 'workflow-123', name: 'test-workflow' }),
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 204,
            json: async () => undefined,
          })
        );

      const created = await client.createWorkflow(workflowRequest);
      expect(created.id).toBe('workflow-123');

      await client.deleteWorkflow('workflow-123');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle full stream lifecycle', async () => {
      const streamRequest: CreateStreamRequest = {
        name: 'test-stream',
        type: 'event_stream',
        started: false,
      };

      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 201,
            json: async () => ({ id: 'stream-123', name: 'test-stream', started: false }),
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 200,
            json: async () => ({ id: 'stream-123', started: true }),
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 200,
            json: async () => ({ id: 'stream-123', started: false }),
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 204,
            json: async () => undefined,
          })
        );

      const created = await client.createStream(streamRequest);
      expect(created.id).toBe('stream-123');
      expect(created.started).toBe(false);

      const started = await client.startStream('stream-123');
      expect(started.started).toBe(true);

      const stopped = await client.stopStream('stream-123');
      expect(stopped.started).toBe(false);

      await client.deleteStream('stream-123');

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should handle transaction creation and deletion', async () => {
      const transactionRequest: CreateTransactionRequest = {
        workflow: 'test-workflow',
        operation: 'test-operation',
        input: { data: 'test' },
        idempotencyKey: 'test-key-123',
      };

      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 200,
            json: async () => ({
              id: 'transaction-123',
              idempotencyKey: 'test-key-123',
            }),
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 204,
            json: async () => undefined,
          })
        );

      const created = await client.createTransaction(transactionRequest);
      expect(created.idempotencyKey).toBe('test-key-123');

      await client.deleteTransaction('test-key-123');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
