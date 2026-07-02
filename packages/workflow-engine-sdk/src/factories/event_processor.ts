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
} from '../types/core';
import { newLogger } from '@kaleido-io/core-sdk/log';
import { formatError, getErrorMessage } from '../utils/errors';
import type { EventProcessorDef } from '../app/types.js';
import type { SetupContext } from '@kaleido-io/core-sdk/context';

const log = newLogger('event_processor_factory');

/**
 * Typed event received by the processor batch function.
 */
export interface EventProcessorEvent<DT> {
  idempotencyKey: string;
  topic: string;
  data: DT;
}

type RawBatchFn<DT> = (
  reqContext: RequestContext,
  events: EventProcessorEvent<DT>[],
  authRef?: string,
) => Promise<void>;

class EventProcessorBase<DT> implements EventProcessor {
  readonly name: string;
  private batchFn: RawBatchFn<DT>;
  private initFn?: (engAPI: EngineAPI) => Promise<void>;
  private closeFn?: () => void;

  constructor(name: string, batchFn: RawBatchFn<DT>) {
    this.name = name;
    this.batchFn = batchFn;
  }

  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): this {
    this.initFn = initFn;
    return this;
  }

  withCloseFn(closeFn: () => void): this {
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

      await this.batchFn(reqContext, events, batch.authRef);

    } catch (error: any) {
      log.error('Event processor batch failed', { error: formatError(error) });
      result.error = getErrorMessage(error);
    }
  }
}

/**
 * Internal factory used by the client to wrap a raw batch function into an
 * EventProcessor handler for the runtime. Not part of the public API.
 */
export function createEventProcessorBase<DT>(
  name: string,
  batchFn: RawBatchFn<DT>,
): EventProcessor {
  return new EventProcessorBase<DT>(name, batchFn);
}

/**
 * Create an event processor handler definition from a batch function.
 *
 * Equivalent to writing `{ processBatch: batchFn }` directly, but consistent
 * with the `createEventSource` / `createTransactionHandler` factory style.
 *
 * The batch function receives an {@link EventProcessorContext} with typed
 * access to `ctx.config`, `ctx.getServiceClientOptions`, a per-request
 * `ctx.signal` (respects the WFE request deadline), and `ctx.requestId`.
 *
 * @param batchFn - Called for every batch of events received from the WFE.
 * @param setup   - Optional setup hook called once before the WFE connection
 *                  is established. Use it to call `ensureStream`, initialise
 *                  assets/pools, or any other one-time work.
 *
 * @example
 * .eventProcessor('my-processor', createEventProcessor(async (_ctx, events) => {
 *   for (const event of events) await writeToStore(event.data);
 * }))
 */
export function createEventProcessor<C = unknown, E = unknown>(
  batchFn: (ctx: import('../app/context.js').EventProcessorContext<C>, events: EventProcessorEvent<E>[]) => Promise<void>,
  setup?: (ctx: SetupContext<C>) => Promise<void>,
): EventProcessorDef<C, E> {
  return setup ? { setup, processBatch: batchFn } : { processBatch: batchFn };
}
