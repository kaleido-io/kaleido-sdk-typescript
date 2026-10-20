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

/**
 * The handler API: write each action as a function of its input, and let the
 * SDK turn what it returns or throws into the engine's result.
 *
 * - Return a value: the stage completes, with the value stored at the stage's
 *   `outputPath`, and the transaction moves to `nextStage`.
 * - Return `complete(output, { stage, events })` to choose the next stage or
 *   emit events, or `waiting({ deadline })` to stay in the stage.
 * - Throw: the stage fails, with the message stored at `/error`, and the
 *   transaction moves to `failureStage`. Throw a `StageError` to choose the
 *   stage or attach data, or a `RetryableError` to have the engine retry.
 *
 * The same definitions run in a custom provider and in the TypeScript provider.
 */

import { createTransactionContext, type EventProcessorContext, type EventSourceContext, type TransactionContext } from '../app/context';
import type { EventProcessorDef } from '../app/types';
import type { EventProcessorEvent } from '../factories/event_processor';
import { createEventSource, type EventSourceBuilder, type EventSourceEvent } from '../factories/event_source';
import { createTransactionHandler } from '../factories/transaction_handler';
import type { ActionConfig, TransactionHandler, TransactionHandlerFn } from '../interfaces/handlers';
import { EvalResult, HandlerEvent, InvocationMode, WithStageDirector, type WSEventStreamInfo } from '../types/core';

// Symbol.for, not Symbol: an outcome or error must be recognised even when it
// comes from another copy of the SDK, for example one bundled into a snippet.
const KIND = Symbol.for('@kaleido-io/workflow-engine-sdk/handler-result');
const DEFINED_TRANSACTION_HANDLER = Symbol.for('@kaleido-io/workflow-engine-sdk/defined-transaction-handler');
const DEFINED_PROCESSOR = Symbol.for('@kaleido-io/workflow-engine-sdk/defined-processor');

/** Returned by `complete()`. */
export interface CompleteOutcome {
  readonly [KIND]: 'complete';
  readonly output?: unknown;
  readonly stage?: string;
  readonly events?: HandlerEvent[];
}

/** Returned by `waiting()`. */
export interface WaitingOutcome {
  readonly [KIND]: 'waiting';
  readonly output?: unknown;
  readonly deadline?: string;
}

export type ActionOutcome = CompleteOutcome | WaitingOutcome;

export interface CompleteOptions {
  /** The stage to move to, instead of the stage's `nextStage`. */
  stage?: string;
  /** Events to emit, for example to wake transactions waiting on a topic. */
  events?: HandlerEvent[];
}

export interface WaitingOptions {
  /** When the engine should evaluate the stage again if nothing else wakes it. */
  deadline?: Date | string;
  /** Output to store at the stage's `outputPath` while waiting. */
  output?: unknown;
}

/** Complete the stage, optionally choosing the next stage or emitting events. */
export function complete(output?: unknown, options: CompleteOptions = {}): CompleteOutcome {
  return { [KIND]: 'complete', output, stage: options.stage, events: options.events };
}

/** Stay in the stage until an event or the deadline wakes it. */
export function waiting(options: WaitingOptions = {}): WaitingOutcome {
  const deadline = options.deadline instanceof Date ? options.deadline.toISOString() : options.deadline;
  return { [KIND]: 'waiting', output: options.output, deadline };
}

export interface StageErrorOptions {
  /** The stage to move to, instead of the stage's `failureStage`. */
  stage?: string;
  /** Data to store at `/errorData` alongside the message at `/error`. */
  data?: unknown;
  cause?: unknown;
}

/** Throw to fail the stage, optionally choosing the stage to move to or attaching data. */
export class StageError extends Error {
  readonly [KIND] = 'stage-error' as const;
  readonly stage?: string;
  readonly data?: unknown;

  constructor(message: string, options: StageErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StageError';
    this.stage = options.stage;
    this.data = options.data;
  }
}

/** Throw when the action should be tried again, for example after a timeout calling another service. */
export class RetryableError extends Error {
  readonly [KIND] = 'retryable-error' as const;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RetryableError';
  }
}

function kindOf(value: unknown): string | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? (value as { [KIND]?: string })[KIND]
    : undefined;
}

/**
 * One action. `input` is the stage's mapped input: the result of the stage's
 * `inputMap`, including the directing fields such as `action` and `nextStage`.
 * Declare its type on the parameter.
 */
// `any` lets each action declare its own input type, and its provider config
// type, on its parameters.
export type TransactionAction<I = any> = (input: I, ctx: TransactionContext<any>) => unknown;

declare const ACTIONS: unique symbol;

/**
 * The map of actions a transaction handler runs, as `defineTransactionHandler`
 * returns it. It is a plain `Map`; the type also remembers each action's input,
 * for `invokeAction` in tests.
 */
export type ActionMap<A extends Record<string, TransactionAction> = Record<string, TransactionAction>> =
  Map<string, ActionConfig<WithStageDirector>> & { readonly [ACTIONS]?: A };

/**
 * An action map whose actions' input types aren't known, such as one built by
 * hand as a `Map`. A map from `defineTransactionHandler` doesn't match it, so
 * that `invokeAction` checks its action names and inputs.
 */
export type UntypedActionMap = Map<string, ActionConfig<any>> & { readonly [ACTIONS]?: undefined };

type HandlerResult = Awaited<ReturnType<TransactionHandlerFn<WithStageDirector>>>;

function toResult(returned: unknown): HandlerResult {
  switch (kindOf(returned)) {
    case 'complete': {
      const { output, stage, events } = returned as CompleteOutcome;
      return { result: EvalResult.COMPLETE, output, customStage: stage, events };
    }
    case 'waiting': {
      const { output, deadline } = returned as WaitingOutcome;
      return { result: EvalResult.WAITING, output, deadline };
    }
    default:
      return { result: EvalResult.COMPLETE, output: returned };
  }
}

function fromError(error: unknown): HandlerResult {
  switch (kindOf(error)) {
    case 'retryable-error':
      return { result: EvalResult.TRANSIENT_ERROR, error: error as Error };
    case 'stage-error': {
      const { stage, data } = error as StageError;
      return { result: EvalResult.HARD_FAILURE, error: error as Error, customStage: stage, errorData: data };
    }
    default:
      return { result: EvalResult.HARD_FAILURE, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * A transaction handler from `defineTransactionHandler`. It is the map of the
 * handler's actions, so it works wherever an action map does, and it carries a
 * `handler`, so it can be registered as it is with `.transactionHandler(name, …)`.
 * A TypeScript provider snippet can export it under any name.
 */
export class DefinedTransactionHandler<A extends Record<string, TransactionAction> = Record<string, TransactionAction>>
  extends Map<string, ActionConfig<WithStageDirector>> {
  declare readonly [ACTIONS]?: A;
  readonly [DEFINED_TRANSACTION_HANDLER] = true;
  /** The handler that runs these actions, for `.transactionHandler(name, …)`. */
  readonly handler: TransactionHandler;

  constructor(actions: A) {
    super();
    for (const [action, run] of Object.entries(actions)) {
      this.set(action, {
        invocationMode: InvocationMode.PARALLEL,
        handler: async (transaction, input, ctx) => {
          try {
            const returned = await run(input ?? {}, ctx ?? createTransactionContext(undefined, '', transaction));
            return toResult(returned);
          } catch (error) {
            return fromError(error);
          }
        },
      });
    }
    // The name a handler registers under comes from .transactionHandler(name, …).
    this.handler = createTransactionHandler('', this);
  }
}

/**
 * Define a transaction handler's actions.
 *
 * @example
 * export const helloHandler = defineTransactionHandler({
 *   hello: async (input: { name: string }) => ({ greeting: `Hello ${input.name}!` }),
 *   'list-pools': async (_input, ctx) => {
 *     const assets = new AssetManagerClient(ctx, 'asset-manager');
 *     return { pools: (await assets.getPools())?.items ?? [] };
 *   },
 * });
 *
 * // In a custom provider:
 * client.transactionHandler('hello', helloHandler);
 */
export function defineTransactionHandler<A extends Record<string, TransactionAction>>(actions: A): DefinedTransactionHandler<A> {
  return new DefinedTransactionHandler(actions);
}

/** True for a value returned by `defineTransactionHandler`, from any copy of the SDK. */
export function isDefinedTransactionHandler(value: unknown): value is DefinedTransactionHandler {
  return value instanceof Map && (value as unknown as Record<symbol, unknown>)[DEFINED_TRANSACTION_HANDLER] === true;
}

/**
 * An event processor from `defineProcessor`. It is both the batch function and
 * a definition with a `processBatch` property, so it can be registered with
 * `.eventProcessor(name, …)` in a custom provider, and a TypeScript provider
 * snippet can export it under any name.
 */
export type DefinedProcessor<CustomConfig = unknown, EventData = unknown> =
  EventProcessorDef<CustomConfig, EventData>['processBatch'] & EventProcessorDef<CustomConfig, EventData>;

/**
 * Define an event processor from a function that handles each batch.
 *
 * @example
 * export const transferProcessor = defineProcessor(async (events: EventProcessorEvent<Transfer>[], ctx) => {
 *   for (const event of events) { ... }
 * });
 */
export function defineProcessor<EventData = unknown, CustomConfig = unknown>(
  fn: (events: EventProcessorEvent<EventData>[], ctx: EventProcessorContext<CustomConfig>) => Promise<void> | void,
): DefinedProcessor<CustomConfig, EventData> {
  const processBatch = async (ctx: EventProcessorContext<CustomConfig>, events: EventProcessorEvent<EventData>[]) => {
    await fn(events, ctx);
  };
  return Object.assign(processBatch, { processBatch, [DEFINED_PROCESSOR]: true });
}

/** True for a value returned by `defineProcessor`, from any copy of the SDK. */
export function isDefinedProcessor(value: unknown): value is DefinedProcessor {
  return typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[DEFINED_PROCESSOR] === true;
}

/** What each poll of an event source from `defineEventSource` receives. */
export interface EventSourcePollInput<CP, CF> {
  /** The stream's config, as `parseConfig` returned it. */
  config: CF;
  /** The checkpoint the previous poll returned, or `initialCheckpoint`'s. Null when there is neither. */
  checkpoint: CP | null;
  /** The stream being polled. */
  stream: WSEventStreamInfo;
}

/** What a poll returns: the checkpoint to resume from, and any events found. */
export interface EventSourcePollOutput<CP, DT> {
  /** Where the next poll resumes from. */
  checkpoint: CP;
  /** The events found, if any. */
  events?: EventSourceEvent<DT>[];
}

/** The functions of an event source. Only `poll` is required. */
export interface EventSourceDefinition<CP, CF = unknown, DT = unknown> {
  /** Look for new events since the checkpoint. Called repeatedly for each stream that uses the source. */
  poll: (input: EventSourcePollInput<CP, CF>, ctx: EventSourceContext<any>) => Promise<EventSourcePollOutput<CP, DT>> | EventSourcePollOutput<CP, DT>;
  /** The checkpoint a new stream starts from. Without it, the first poll gets null. */
  initialCheckpoint?: (config: CF) => Promise<CP> | CP;
  /** Check and convert a stream's raw config. Throw to reject it. Without it, the raw config is used as it is. */
  parseConfig?: (stream: WSEventStreamInfo, config: any) => Promise<CF> | CF;
  /** Clean up when a stream that uses the source is deleted. */
  onDelete?: (stream: WSEventStreamInfo) => Promise<void> | void;
}

/**
 * Define an event source. Each poll gets its input and a context that resolves
 * service bindings as the stream's owner.
 *
 * @example
 * export const poolWatcher = defineEventSource<{ seen: number }, unknown, Pool>('pool-watcher', {
 *   poll: async ({ checkpoint }, ctx) => {
 *     const pools = (await new AssetManagerClient(ctx, 'asset-manager').getPools())?.items ?? [];
 *     const fresh = pools.slice(checkpoint?.seen ?? 0);
 *     return {
 *       checkpoint: { seen: pools.length },
 *       events: fresh.map((pool) => ({ idempotencyKey: pool.id, topic: 'pool-created', data: pool })),
 *     };
 *   },
 * });
 *
 * // In a custom provider:
 * client.eventSource(poolWatcher);
 */
export function defineEventSource<CP, CF = unknown, DT = unknown>(
  name: string,
  definition: EventSourceDefinition<CP, CF, DT>,
): EventSourceBuilder<CP, CF, DT> {
  const source = createEventSource<CP, CF, DT>(name, async (conf, checkpoint, _authRef, ctx) => {
    const { config, ...stream } = conf;
    // The SDK always passes a poll its context; only a direct call of the poll function could leave it out.
    const output = await definition.poll({ config, checkpoint, stream }, ctx!);
    return { checkpointOut: output.checkpoint, events: output.events ?? [] };
  });
  const { initialCheckpoint, parseConfig, onDelete } = definition;
  if (initialCheckpoint) {
    source.withInitialCheckpoint(async (config) => initialCheckpoint(config));
  }
  if (parseConfig) {
    source.withConfigParser(async (stream, config) => parseConfig(stream, config));
  }
  if (onDelete) {
    source.withDeleteFn(async (stream) => onDelete(stream));
  }
  return source;
}
