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
import { root } from "@kaleido-io/core-sdk/kurn";
import { newLogger } from "@kaleido-io/core-sdk/log";
import type { EventProcessorDef } from "@kaleido-io/workflow-engine-sdk";
import { BulkUpsertBuilder, type IBulkUpsertClient } from "../bulk-upsert-builder.js";
import type { BulkUpsertInput, Event, Signal, Transaction } from "../schema.js";
import { SubledgerClient } from "../subledger.js";

const log = newLogger("subledger-state-machine");

// ---------------------------------------------------------------------------
// Type aliases

export type LifecycleEvent = Event;
export type SubledgerReader = Pick<SubledgerClient, "bulkQuery">;

// ---------------------------------------------------------------------------
// Definitions

/** The transaction label that holds the handler's state. */
export const STATE_LABEL = "state";

/**
 * The context passed to all transitions: the handler's config, the read-only
 * subledger client, and a builder for the new rows the transition writes.
 */
export interface TransitionContext<Config = unknown> {
  config: Config;
  subledger: SubledgerReader;
  builder: BulkUpsertBuilder;
}

/**
 * The input to a transition: the full transaction with its children, its
 * current state, the event, and for `condition-signaled` only, the signal it
 * reports.
 */
export interface TransitionInput {
  transaction: Transaction;
  state: string;
  event: LifecycleEvent;
  signal?: Signal;
}

/**
 * What a transition function returns: move to a new state, stay in the current
 * one, or opt out and pass the event to the next matching transition instead.
 */
export type Next = { action: "go"; state: string } | { action: "stay" } | { action: "pass" };

/** A handler function for a transition */
export type TransitionFn<Config = unknown> = (
  ctx: TransitionContext<Config>,
  input: TransitionInput,
) => Next | Promise<Next>;

/** A possible transition: the states it may move to, and the function that decides. */
export interface TransitionEntry<Config = unknown> {
  to: string[];
  run: TransitionFn<Config>;
}

/** Transitions out of one state, by event name (glob wildcards supported). */
export type StateTransitions<Config = unknown> = Record<string, TransitionEntry<Config>>;

/** The state machine definition. */
export interface StateMachineDef<Config = unknown> {
  /** Name of the subledger service binding. Defaults to `subledger`. */
  subledger?: string;
  /** The state of a transaction with no state label. */
  initial: string;
  /** Final states, for which the `*` state does not apply. */
  final: string[];
  /**
   * Allowed transitions by state, tried in declaration order. The special `*`
   * state should be defined last, and applies to every non-final state.
   */
  states: Record<string, StateTransitions<Config>>;
}

/**
 * The result of an evaluation:: the event key of the transition that handled the event,
 * the state it was in and the state it moves to (the same when it stays), and the body
 * to write back to subledger.
 */
export interface EvaluationResult {
  eventKey: string;
  from: string;
  to: string;
  body: BulkUpsertInput;
}

/** Define a transaction type's state machine. `Config` is the type of the handler's config. */
export function stateMachine<Config = unknown>(def: StateMachineDef<Config>): StateMachine<Config> {
  return new StateMachine(def);
}

/** Move to `state`. */
export function go(state: string): Next {
  return { action: "go", state };
}

/** Keep the current state. */
export function stay(): Next {
  return { action: "stay" };
}

/** Pass the event to the next matching transition. */
export function pass(): Next {
  return { action: "pass" };
}

/** A step's reference within the transaction, `<transaction>:<step>`. */
export function stepRef(transaction: Transaction, step: string): string {
  return `${transaction.name}:${step}`;
}

// ---------------------------------------------------------------------------
// The machine

/** The special state that matches every non-final state. */
const ANY = "*";

/**
 * The state machine for one transaction type, driven by its lifecycle
 * events. A transaction's state is stored in its `state` label.
 *
 * For each event, the transitions of the current state are tried in order,
 * then those of the `*` state (unless the current state is final). Each
 * matched transition function is given the opportunity to handle the event,
 * and the first one that chooses to do so can write or update any items in
 * the subledger, and can move the transaction to a new state.
 *
 * `eventProcessor()` runs the machine on a stream of lifecycle events.
 */
export class StateMachine<Config = unknown> {
  constructor(readonly def: StateMachineDef<Config>) {}

  /** Compute a transition's input. */
  input(transaction: Transaction, event: LifecycleEvent, signal?: Signal): TransitionInput {
    const state = transaction.labels?.[STATE_LABEL] ?? this.def.initial;
    return { transaction, state, event, signal };
  }

  /** Check whether any state has a transition for the event. */
  handles(eventName: string): boolean {
    return Object.values(this.def.states).some((table) =>
      Object.keys(table).some((eventKey) => matchesKey(eventKey, eventName)),
    );
  }

  /**
   * All possible transitions for an event in a given state: the state's own matches
   * in order, then the `*` state's.
   */
  lookup(state: string, eventName: string): ({ eventKey: string } & TransitionEntry<Config>)[] {
    const tables = [this.def.states[state]];
    if (!this.def.final.includes(state)) {
      tables.push(this.def.states[ANY]);
    }
    return tables.flatMap((table) =>
      Object.entries(table ?? {})
        .filter(([eventKey]) => matchesKey(eventKey, eventName))
        .map(([eventKey, entry]) => ({ eventKey, ...entry })),
    );
  }

  /**
   * Evaluate an event: run the transitions that match it, each with a fresh
   * builder, until one handles it (does not pass), and add the state label to
   * what it wrote. A move to a state outside the transition's `to` is an error.
   */
  async evaluate(
    ctx: Omit<TransitionContext<Config>, "builder">,
    input: TransitionInput,
  ): Promise<EvaluationResult | undefined> {
    const name = input.event.name;
    const matches = name ? this.lookup(input.state, name) : [];
    for (const { eventKey, to, run } of matches) {
      const builder = transitionBuilder();
      const next = await run({ ...ctx, builder }, input);
      if (next.action === "pass") {
        continue;
      }
      const state = next.action === "go" ? next.state : input.state;
      if (state !== input.state && !to.includes(state)) {
        throw new Error(
          `Transition ${input.state} on ${eventKey} moved to ${state}, which is not in its to: ${to.join(", ")}`,
        );
      }
      if (state === input.state && !builder.hasUpdates()) {
        return undefined;
      }
      builder.lifecycle.add({
        transactions: [
          {
            transactionTypeUrn: input.transaction.transactionTypeUrn,
            items: [{ name: input.transaction.name, labels: { [STATE_LABEL]: state } }],
          },
        ],
      });
      return { from: input.state, to: state, eventKey, body: builder.toBulkUpsert() };
    }
    return undefined;
  }

  /**
   * The event processor: for each event of a batch, in order, read its
   * transaction, run the transition, and write the body. The handler's config
   * is passed through as `Config`, unchecked. It relies on the stream
   * delivering a transaction's events in order, one at a time: evaluating a
   * redelivered event writes the same rows again, and the defaults ignore them.
   */
  eventProcessor(): EventProcessorDef<unknown, LifecycleEvent> {
    return {
      processBatch: async (engineCtx, events) => {
        // Per batch: the context carries the batch's authRef and deadline signal.
        const client = new SubledgerClient(engineCtx, this.def.subledger ?? "subledger");
        const ctx = { config: engineCtx.config as Config, subledger: client };
        for (const { data: event } of events) {
          if (event.name && event.transactionUrn && this.handles(event.name)) {
            await this.process(client, ctx, event);
          }
        }
      },
    };
  }

  /**
   * A mermaid `stateDiagram-v2` of the machine: one arrow per source and
   * target, labelled with the event keys that take it. The `*` state is drawn
   * as one "any state" node.
   */
  mermaid(): string {
    const node = (state: string) => (state === ANY ? "anyState" : state);

    const eventKeysByArrow = new Map<string, string[]>();
    const reached = new Set<string>();
    for (const [from, table] of Object.entries(this.def.states)) {
      for (const [eventKey, { to }] of Object.entries(table)) {
        for (const target of to) {
          const arrow = `${node(from)} --> ${target}`;
          eventKeysByArrow.set(arrow, [...(eventKeysByArrow.get(arrow) ?? []), eventKey]);
          reached.add(target);
        }
      }
    }

    const lines = ["stateDiagram-v2"];
    if (this.def.states[ANY]) {
      lines.push(`    state "any state" as ${node(ANY)}`);
    }
    lines.push(`    [*] --> ${this.def.initial}`);
    for (const [arrow, eventKeys] of eventKeysByArrow) {
      lines.push(`    ${arrow}: ${eventKeys.join("<br/>")}`);
    }
    for (const state of reached) {
      if (this.def.final.includes(state)) {
        lines.push(`    ${state} --> [*]`);
      }
    }
    return lines.join("\n");
  }

  private async process(
    client: SubledgerClient,
    ctx: Omit<TransitionContext<Config>, "builder">,
    event: LifecycleEvent,
  ): Promise<void> {
    const read = await readTransaction(client, event);
    if (!read) {
      log.warn(`${event.transactionUrn} not found; skipping ${event.name}`);
      return;
    }
    const result = await this.evaluate(ctx, this.input(read.transaction, event, read.signal));
    if (!result) {
      return;
    }
    await client.bulkUpsert(result.body);
    log.info(`${read.transaction.name} ${event.name}: ${result.from} -> ${result.to}`);
  }
}

// ---------------------------------------------------------------------------
// Internals

/** Whether an event key (a glob where `*` matches any run of characters) matches an event name. */
export function matchesKey(eventKey: string, eventName: string): boolean {
  // TODO: once the SDK's minimum is Node 24, match with a RegExp built from the
  // key's parts with RegExp.escape.
  const [first, ...rest] = eventKey.split("*");
  if (rest.length === 0) {
    return eventName === first;
  }
  const last = rest.pop()!;
  if (!eventName.startsWith(first)) {
    return false;
  }
  let from = first.length;
  for (const part of rest) {
    const at = eventName.indexOf(part, from);
    if (at < 0) {
      return false;
    }
    from = at + part.length;
  }
  return eventName.length - from >= last.length && eventName.endsWith(last);
}

/**
 * A builder for one transition, with writes disabled (the event processor will write
 * the body).
 */
function transitionBuilder(): BulkUpsertBuilder {
  // The event processor writes the body; the builder itself never executes.
  const noWrites: IBulkUpsertClient = {
    bulkUpsert: () =>
      Promise.reject(new Error("a transition's builder cannot be executed directly")),
  };
  return new BulkUpsertBuilder(noWrites, {
    defaults: { updateStrategy: "create_or_ignore", labelStrategy: "create_or_update" },
  });
}

/**
 * Read an event's transaction in one query: the transaction with its children, and for
 * a `condition-signaled` event, the signal it reports.
 */
export async function readTransaction(
  client: SubledgerReader,
  event: LifecycleEvent,
): Promise<{ transaction: Transaction; signal?: Signal } | undefined> {
  const urn = event.transactionUrn;
  const signalKey = (event.detail as { signalIdempotencyKey?: string } | undefined)
    ?.signalIdempotencyKey;
  const out = await client.bulkQuery({
    lifecycle: {
      transactions: [
        {
          transactionTypeUrn: root(urn),
          equal: [{ field: "urn", value: urn }],
          limit: 1,
        },
      ],
      ...(signalKey
        ? { signals: { equal: [{ field: "idempotencyKey", value: signalKey }], limit: 1 } }
        : {}),
    },
    options: { includeChildren: true },
  });
  const transaction = out.lifecycle?.transactions?.[0]?.items?.[0];
  return transaction && { transaction, signal: out.lifecycle?.signals?.items?.[0] };
}
