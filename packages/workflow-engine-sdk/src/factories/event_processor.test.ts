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

import { describe, it, expect, jest } from '@jest/globals';

// quietens the console during tests
import '../../tests/mock-logger';

import { createEventProcessor, createEventProcessorBase, EventProcessorEvent } from './event_processor';
import { WSEventProcessorBatchRequest, WSEventProcessorBatchResult, WSMessageType } from '../types/core';
import { EngineClient, EngineClientRuntime } from '../runtime/engine_client';

interface TestEventData {
  id: number;
  value: string;
}

function makeBatch(events: { idempotencyKey: string; topic: string; data: TestEventData }[]): WSEventProcessorBatchRequest {
  return {
    messageType: WSMessageType.EVENT_PROCESSOR_BATCH,
    id: 'batch-id',
    handler: 'test-processor',
    streamName: 'test-stream',
    streamId: 'stream-1',
    events,
  };
}

function makeResult(): WSEventProcessorBatchResult {
  return {
    messageType: WSMessageType.EVENT_PROCESSOR_BATCH_RESULT,
    id: 'batch-id',
    handler: 'test-processor',
  };
}

// ---------------------------------------------------------------------------
// createEventProcessor — high-level factory (returns EventProcessorDef)
// ---------------------------------------------------------------------------

describe('createEventProcessor (high-level factory)', () => {
  it('returns a def with processBatch and no setup when setup is omitted', () => {
    const batchFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const def = createEventProcessor(batchFn as never);
    expect(def.processBatch).toBe(batchFn);
    expect(def.setup).toBeUndefined();
  });

  it('returns a def with both processBatch and setup when setup is provided', () => {
    const batchFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const setupFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const def = createEventProcessor(batchFn as never, setupFn as never);
    expect(def.processBatch).toBe(batchFn);
    expect(def.setup).toBe(setupFn);
  });
});

// ---------------------------------------------------------------------------
// createEventProcessorBase — internal factory (returns EventProcessor handler)
// ---------------------------------------------------------------------------

describe('createEventProcessorBase (internal handler factory)', () => {
  it('should create an event processor handler', () => {
    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async (_reqContext, _events) => {}
    );
    expect(processor).toBeDefined();
    expect(processor.name).toBe('test-processor');
  });

  it('should support init and close lifecycle hooks', async () => {
    const initFn = jest.fn(() => Promise.resolve());
    const closeFn = jest.fn();
    const engineClientRuntime = {
      sendMessage: jest.fn(),
      isWebSocketConnected: true,
      generateId: jest.fn(() => 'test'),
    } as any as EngineClientRuntime;
    const engineClient = new EngineClient(engineClientRuntime);

    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async (_reqContext, _events) => {}
    ) as any;

    processor.withInitFn(initFn).withCloseFn(closeFn);

    await processor.init(engineClient);
    expect(initFn).toHaveBeenCalledTimes(1);

    processor.close();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('should process a batch and invoke the batch function', async () => {
    const batchFn = jest.fn(async (_reqContext: any, _events: EventProcessorEvent<TestEventData>[]) => {});

    const processor = createEventProcessorBase<TestEventData>('test-processor', batchFn);

    const batch = makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } },
      { idempotencyKey: 'key2', topic: 'test-topic', data: { id: 2, value: 'b' } },
    ]);
    const result = makeResult();

    await processor.eventProcessorBatch({} as any, result, batch);

    expect(batchFn).toHaveBeenCalledTimes(1);
    const receivedEvents = batchFn.mock.calls[0][1] as EventProcessorEvent<TestEventData>[];
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].data.id).toBe(1);
    expect(receivedEvents[0].data.value).toBe('a');
  });

  it('should call the batch function with all events', async () => {
    let receivedCount = 0;
    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async (_reqContext, events) => { receivedCount = events.length; }
    );

    const batch = makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'odd' } },
      { idempotencyKey: 'key2', topic: 'test-topic', data: { id: 2, value: 'even' } },
      { idempotencyKey: 'key3', topic: 'test-topic', data: { id: 3, value: 'odd' } },
      { idempotencyKey: 'key4', topic: 'test-topic', data: { id: 4, value: 'even' } },
    ]);
    const result = makeResult();

    await processor.eventProcessorBatch({} as any, result, batch);

    expect(receivedCount).toBe(4);
  });

  it('should handle batch errors and set error on result', async () => {
    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async () => { throw new Error('processing failed'); }
    );

    const result = makeResult();
    await processor.eventProcessorBatch({} as any, result, makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } },
    ]));

    expect(result.error).toBe('processing failed');
  });

  it('should pass empty batch to function when no events', async () => {
    const batchFn = jest.fn(async (_reqContext: any, _events: EventProcessorEvent<TestEventData>[], _authRef?: string) => {});
    const processor = createEventProcessorBase<TestEventData>('test-processor', batchFn);

    const result = makeResult();
    await processor.eventProcessorBatch({} as any, result, makeBatch([]));

    expect(batchFn).toHaveBeenCalledWith(expect.anything(), [], undefined);
  });

  it('should thread authRef from the batch through to the batch function', async () => {
    let capturedAuthRef: string | undefined;
    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async (_reqContext, _events, authRef) => {
        capturedAuthRef = authRef;
      }
    );

    const batch: WSEventProcessorBatchRequest = {
      ...makeBatch([{ idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } }]),
      authRef: 'user-auth-ref-123',
    };

    await processor.eventProcessorBatch({} as any, makeResult(), batch);
    expect(capturedAuthRef).toBe('user-auth-ref-123');
  });

  it('should not call init or close when no functions are registered', async () => {
    const engineClientRuntime = {
      sendMessage: jest.fn(),
      isWebSocketConnected: true,
      generateId: jest.fn(() => 'test'),
    } as any as EngineClientRuntime;
    const engineClient = new EngineClient(engineClientRuntime);

    const processor = createEventProcessorBase<TestEventData>(
      'test-processor',
      async (_reqContext, _events) => {}
    );

    await expect(processor.init(engineClient)).resolves.toBeUndefined();
    expect(() => processor.close()).not.toThrow();
  });
});
