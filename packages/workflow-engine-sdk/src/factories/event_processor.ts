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

import {
  EventProcessor,
  EngineAPI,
} from '../interfaces/handlers';
import {
  RequestContext,
  WSEventProcessorBatchRequest,
  WSEventProcessorBatchResult,
  ListenerEvent,
} from '../types/core';
import { newLogger } from '../log/logger';
import { getErrorMessage } from '../utils/errors';

const log = newLogger('event_processor_factory');

/**
 * Typed event received by the processor batch function.
 */
export interface EventProcessorEvent<DT> {
  idempotencyKey: string;
  topic: string;
  data: DT;
}

/**
 * Batch function signature for event processors.
 *
 * Receives a typed batch of events and returns the processed events (which may
 * be filtered or enriched) plus an optional checkpoint.
 *
 * **Checkpoint semantics**: `checkpointOut` is write-only. The engine persists
 * it for operator observability (e.g. monitoring dashboards) but does NOT
 * return it in subsequent batch requests. It cannot be used for resumption —
 * position tracking for the underlying data source belongs in the event
 * source checkpoint, not here. Use an ordered, incrementing value such as a
 * block number so that progress is meaningful to operators.
 */
export type EventProcessorBatchFn<DT = unknown> = (
  reqContext: RequestContext,
  events: EventProcessorEvent<DT>[]
) => Promise<{ events: EventProcessorEvent<DT>[] }>;

/**
 * Builder interface for configuring event processors with optional lifecycle hooks.
 */
export interface EventProcessorBuilder<DT = unknown> extends EventProcessor {
  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): EventProcessorBuilder<DT>;
  withCloseFn(closeFn: () => void): EventProcessorBuilder<DT>;
}

class EventProcessorBase<DT> implements EventProcessorBuilder<DT> {
  private _name: string;
  private batchFn: EventProcessorBatchFn<DT>;
  private initFn?: (engAPI: EngineAPI) => Promise<void>;
  private closeFn?: () => void;

  constructor(name: string, batchFn: EventProcessorBatchFn<DT>) {
    this._name = name;
    this.batchFn = batchFn;
  }

  name(): string {
    return this._name;
  }

  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): EventProcessorBuilder<DT> {
    this.initFn = initFn;
    return this;
  }

  withCloseFn(closeFn: () => void): EventProcessorBuilder<DT> {
    this.closeFn = closeFn;
    return this;
  }

  async init(engAPI: EngineAPI): Promise<void> {
    if (this.initFn) {
      await this.initFn(engAPI);
    }
  }

  close(): void {
    if (this.closeFn) {
      this.closeFn();
    }
  }

  async eventProcessorBatch(
    reqContext: RequestContext,
    result: WSEventProcessorBatchResult,
    batch: WSEventProcessorBatchRequest
  ): Promise<void> {
    try {
      const events: EventProcessorEvent<DT>[] = batch.events.map((evt): EventProcessorEvent<DT> => ({
        idempotencyKey: evt.idempotencyKey,
        topic: evt.topic,
        data: evt.data as DT,
      }));

      const batchResult = await this.batchFn(reqContext, events);

      result.events = batchResult.events.map((evt): ListenerEvent => ({
        idempotencyKey: evt.idempotencyKey,
        topic: evt.topic,
        data: evt.data,
      }));

    } catch (error) {
      log.error('Event processor batch failed', { error });
      result.error = getErrorMessage(error);
    }
  }
}

/**
 * Create a new event processor with a typed batch function.
 *
 * @param name - Handler name to register with the workflow engine
 * @param batchFn - Function that processes a typed batch of events
 * @returns EventProcessorBuilder for chaining optional configuration
 *
 * @example
 * const processor = createEventProcessor<TokenTransfer, IndexerCheckpoint>(
 *   'token-indexer',
 *   async (events) => {
 *     const processed = events.filter(e => e.data.value > 0n);
 *     return { events: processed, checkpointOut: { lastBlock: processed.at(-1)?.data.blockNumber } };
 *   }
 * );
 */
export function createEventProcessor<DT = unknown>(
  name: string,
  batchFn: EventProcessorBatchFn<DT>
): EventProcessorBuilder<DT> {
  return new EventProcessorBase<DT>(name, batchFn);
}
