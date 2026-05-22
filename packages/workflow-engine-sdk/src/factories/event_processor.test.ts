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

import { createEventProcessor, EventProcessorEvent } from './event_processor';
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
    events: [],
  };
}

describe('createEventProcessor', () => {

  it('should create an event processor', () => {
    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async (events) => ({ events })
    );
    expect(processor).toBeDefined();
    expect(processor.name()).toBe('test-processor');
  });

  it('should create an event processor with init and close functions', async () => {
    const initFn = jest.fn(() => Promise.resolve());
    const closeFn = jest.fn();
    const engineClientRuntime = {
      sendMessage: jest.fn(),
      getActiveHandlerContext: jest.fn(() => ({ requestId: 'test', authTokens: { test: 'test' } })),
      isWebSocketConnected: jest.fn(() => true),
      generateId: jest.fn(() => 'test'),
    } as any as EngineClientRuntime;
    const engineClient = new EngineClient(engineClientRuntime);

    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async (events) => ({ events })
    )
      .withInitFn(initFn)
      .withCloseFn(closeFn);

    await processor.init(engineClient);
    expect(initFn).toHaveBeenCalledTimes(1);

    processor.close();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('should process a batch and return typed events', async () => {
    const batchFn = jest.fn(async (events: EventProcessorEvent<TestEventData>[]) => ({
      events,
      checkpointOut: { lastProcessedTime: 12345 },
    }));

    const processor = createEventProcessor<TestEventData>('test-processor', batchFn);

    const batch = makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } },
      { idempotencyKey: 'key2', topic: 'test-topic', data: { id: 2, value: 'b' } },
    ]);
    const result = makeResult();

    await processor.eventProcessorBatch(result, batch);

    expect(batchFn).toHaveBeenCalledTimes(1);
    const receivedEvents = batchFn.mock.calls[0][0] as EventProcessorEvent<TestEventData>[];
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].data.id).toBe(1);
    expect(receivedEvents[0].data.value).toBe('a');

    expect(result.events).toHaveLength(2);
    expect(result.events[0].idempotencyKey).toBe('key1');
    expect(result.events[0].data).toEqual({ id: 1, value: 'a' });
  });

  it('should allow filtering events from the batch', async () => {
    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async (events) => ({
        events: events.filter(e => e.data.id % 2 === 0),
      })
    );

    const batch = makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'odd' } },
      { idempotencyKey: 'key2', topic: 'test-topic', data: { id: 2, value: 'even' } },
      { idempotencyKey: 'key3', topic: 'test-topic', data: { id: 3, value: 'odd' } },
      { idempotencyKey: 'key4', topic: 'test-topic', data: { id: 4, value: 'even' } },
    ]);
    const result = makeResult();

    await processor.eventProcessorBatch(result, batch);

    expect(result.events).toHaveLength(2);
    expect(result.events[0].idempotencyKey).toBe('key2');
    expect(result.events[1].idempotencyKey).toBe('key4');
  });

  it('should not set checkpoint when checkpointOut is not returned', async () => {
    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async (events) => ({ events })
    );

    const result = makeResult();
    await processor.eventProcessorBatch(result, makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } },
    ]));
  });

  it('should handle batch errors and set error on result', async () => {
    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async () => { throw new Error('processing failed'); }
    );

    const result = makeResult();
    await processor.eventProcessorBatch(result, makeBatch([
      { idempotencyKey: 'key1', topic: 'test-topic', data: { id: 1, value: 'a' } },
    ]));

    expect(result.error).toBe('processing failed');
    expect(result.events).toHaveLength(0);
  });

  it('should pass empty batch to function when no events', async () => {
    const batchFn = jest.fn(async (events: EventProcessorEvent<TestEventData>[]) => ({ events }));
    const processor = createEventProcessor<TestEventData>('test-processor', batchFn);

    const result = makeResult();
    await processor.eventProcessorBatch(result, makeBatch([]));

    expect(batchFn).toHaveBeenCalledWith([]);
    expect(result.events).toHaveLength(0);
  });

  it('should not call init or close when no functions are registered', async () => {
    const engineClientRuntime = {
      sendMessage: jest.fn(),
      getActiveHandlerContext: jest.fn(() => ({ requestId: 'test', authTokens: {} })),
      isWebSocketConnected: jest.fn(() => true),
      generateId: jest.fn(() => 'test'),
    } as any as EngineClientRuntime;
    const engineClient = new EngineClient(engineClientRuntime);

    const processor = createEventProcessor<TestEventData>(
      'test-processor',
      async (events) => ({ events })
    );

    await expect(processor.init(engineClient)).resolves.toBeUndefined();
    expect(() => processor.close()).not.toThrow();
  });
});
