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
import { BulkUpsertBuilder, type IBulkUpsertClient } from "../bulk-upsert-builder.js";
import type {
  BulkUpsertInput,
  Condition,
  Event,
  Step,
  StepInput,
  StepOutcomeInput,
  StepStartInput,
  Transaction,
  TransactionOutcomeInput,
} from "../schema.js";
import { SubledgerClient } from "../subledger.js";

const log = newLogger("subledger-state-machine");

// ---------------------------------------------------------------------------
// Type aliases

export type LifecycleEvent = Event;
export type SubledgerReader = Pick<SubledgerClient, "bulkQuery">;
export type SubledgerWriter = Pick<SubledgerClient, "bulkUpsert">;

// ---------------------------------------------------------------------------
// Definitions

/** The transaction label that holds the handler's state. */
export const STATE_LABEL = "state";

/** The state machine definition. */
export interface StateMachineDef<Config = unknown> {
  /** The initial state of a transaction, i.e. one with no state label. */
  initial: string;
  /** Final states, for which the `*` state does not apply. */
  final: string[];
  /** The states, with their steps and transitions. */
  states: Record<string, StateDef<Config>>;
  /** Whether the machine drives a transaction, for hosts that run several machines. Defaults to every transaction. */
  transactionFilter?: (transaction: Transaction) => boolean;
  /** Options for how the machine runs. */
  options?: StateMachineOptions;
}

/** Options for how a state machine runs. */
export interface StateMachineOptions {
  /**
   * Apply `startNextStep` after each event's transition has run. Defaults to
   * false. When set:
   * - going to a state starts its first pending step
   * - adding steps to the state and staying in that state starts the next
   *   pending step
   * - a completed outcome of a step in the current state starts the next
   *   pending step in the current state
   */
  autoStartSteps?: boolean;
}

const DEFAULT_OPTIONS: Required<StateMachineOptions> = {
  autoStartSteps: false,
};

/** One state: the steps the transaction does in it, and its transitions. */
export interface StateDef<Config = unknown> {
  /** Every step a transaction may do in this state, in the order they run. */
  steps?: string[];
  /** Transitions out of the state, by event key. */
  on?: StateTransitions<Config>;
}

/** Transitions out of one state, by event key. */
export type StateTransitions<Config = unknown> = Partial<
  Record<EventKey, TransitionEntry<Config> | Go>
>;

/**
 * An event key: a lifecycle event name in which `*` may stand for a whole
 * segment. `step-outcome.notify` matches that event, `step-outcome.*` any
 * step's outcome, `condition-signaled.mint.*` every signal meeting the `mint`
 * condition.
 */
export type EventKey =
  | "transaction-accepted"
  | "transaction-outcome"
  | `${"step-added" | "step-started" | "step-outcome" | "leg-added" | "condition-added"}.${string}`
  | `condition-signaled.${string}.${string}`;

/** The number of parts each type of event name has after its type. */
const NAME_PARTS: Record<LifecycleEvent["eventType"], number> = {
  "transaction-accepted": 0,
  "transaction-outcome": 0,
  "step-added": 1,
  "step-started": 1,
  "step-outcome": 1,
  "leg-added": 1,
  "condition-added": 1,
  "condition-signaled": 2,
};

/** A possible transition: the states it may go to, and the function that decides. */
export interface TransitionEntry<Config = unknown> {
  to: string[];
  run: TransitionFn<Config>;
}

/** The function that decides a transition: it adds the rows to write, and returns what happens next. */
export type TransitionFn<Config = unknown> = (
  ctx: TransitionContext<Config>,
  input: TransitionInput,
) => Next | Promise<Next>;

/** What the caller of `evaluate` supplies: the handler's config, and the read-only subledger client. */
export interface EvaluationContext<Config = unknown> {
  config: Config;
  subledger: SubledgerReader;
}

/**
 * What a transition receives: the evaluation context, a builder for the new
 * rows the transition writes, and the machine's definition.
 */
export interface TransitionContext<Config = unknown> extends EvaluationContext<Config> {
  builder: BulkUpsertBuilder;
  def: StateMachineDef<Config>;
}

/** The input to a transition: the full transaction with its children, its current state, and the event. */
export interface TransitionInput {
  transaction: Transaction;
  state: string;
  event: LifecycleEvent;
}

/**
 * What a transition function returns: go to a new state, stay in the current
 * one, or opt out and pass the event to the next matching transition instead.
 */
export type Next = Go | { action: "stay" } | { action: "pass" };
export type Go = { action: "go"; state: string };

/** Define a transaction type's state machine. `Config` is the type of the handler's config. */
export function stateMachine<Config = unknown>(def: StateMachineDef<Config>): StateMachine<Config> {
  return new StateMachine(def);
}

/** Move to `state`. */
export function go(state: string): Go {
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

/**
 * Wrap a step outcome's transition to run only when the step outcome
 * is "completed".
 */
export function ifCompleted<Config = unknown>(
  transition: TransitionEntry<Config> | Go,
): TransitionEntry<Config> {
  return ifStepStatus("completed", transition);
}

/**
 * Wrap a step outcome's transition to run only when the step outcome
 * is "failed".
 */
export function ifFailed<Config = unknown>(
  transition: TransitionEntry<Config> | Go,
): TransitionEntry<Config> {
  return ifStepStatus("failed", transition);
}

function ifStepStatus<Config>(
  status: StepOutcomeInput["status"],
  transition: TransitionEntry<Config> | Go,
): TransitionEntry<Config> {
  const { to, run } = entryOf(transition);
  return {
    to,
    run: (ctx, input) => {
      const { transaction, event } = input;
      const step = transaction.steps?.find((s) => s.urn === event.subjectUrn);
      return step?.status === status ? run(ctx, input) : pass();
    },
  };
}

// ---------------------------------------------------------------------------
// Steps

export interface StepDef extends Omit<StepInput, "transactionUrn"> {
  state: string;
}
export type StepStartDef = Omit<StepStartInput, "stepUrn">;
export type StepOutcomeDef = Omit<StepOutcomeInput, "stepUrn">;
export type TransactionOutcomeDef = Omit<TransactionOutcomeInput, "transactionUrn">;

export function stepUrn(transaction: Transaction, step: string): string {
  return `${transaction.urn}:step=${step}`;
}

/**
 * Add pending steps to the transaction, each labeled with the state it runs
 * in. Labels are written create_or_ignore, so a step's state is fixed once added.
 */
export function addSteps<Config>(
  ctx: TransitionContext<Config>,
  transaction: Transaction,
  steps: StepDef[],
): void {
  ctx.builder.lifecycle.configure({
    steps: { labelStrategy: "create_or_ignore" },
  });
  ctx.builder.lifecycle.add({
    steps: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: steps.map(({ state, labels, ...step }) => ({
          ...step,
          transactionUrn: transaction.urn,
          labels: { ...labels, [STATE_LABEL]: state },
        })),
      },
    ],
  });
}

/** Start one of the transaction's steps. */
export function startStep<Config>(
  ctx: TransitionContext<Config>,
  transaction: Transaction,
  step: string,
  start: StepStartDef = {},
): void {
  ctx.builder.lifecycle.add({
    stepStarts: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ ...start, stepUrn: stepUrn(transaction, step) }],
      },
    ],
  });
}

/** Conclude one of the transaction's steps. */
export function concludeStep<Config>(
  ctx: TransitionContext<Config>,
  transaction: Transaction,
  step: string,
  outcome: StepOutcomeDef,
): void {
  ctx.builder.lifecycle.add({
    stepOutcomes: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ ...outcome, stepUrn: stepUrn(transaction, step) }],
      },
    ],
  });
}

/** Conclude the transaction. */
export function concludeTransaction<Config>(
  ctx: TransitionContext<Config>,
  transaction: Transaction,
  outcome: TransactionOutcomeDef,
): void {
  ctx.builder.lifecycle.add({
    transactionOutcomes: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ ...outcome, transactionUrn: transaction.urn }],
      },
    ],
  });
}

/**
 * Start the first of `state`'s pending steps, in the order the state lists
 * them, unless one of its steps is running or has failed. Returns the step
 * it started.
 */
export function startNextStep<Config>(
  ctx: TransitionContext<Config>,
  input: TransitionInput,
  state: string,
): string | undefined {
  const { def, builder } = ctx;
  const { transaction, event } = input;
  const steps = stepsOf(transaction, state, builder);
  if (steps.some((s) => s.status === "started" || s.status === "failed")) {
    return undefined;
  }
  const pending = def.states[state]?.steps?.find((name) =>
    steps.some((s) => s.name === name && s.status === "pending"),
  );
  if (pending) {
    startStep(ctx, transaction, pending, { causationUrn: event.urn });
  }
  return pending;
}

/**
 * The transaction's steps in `state`. If a builder is provided, the
 * unwritten steps and step starts are also included.
 */
function stepsOf(
  transaction: Transaction,
  state: string,
  builder?: BulkUpsertBuilder,
): Pick<Step, "name" | "status">[] {
  const steps = (transaction.steps ?? [])
    .filter((s) => s.labels?.[STATE_LABEL] === state)
    .map(({ name, status }): Pick<Step, "name" | "status"> => ({ name, status }));
  if (!builder) {
    return steps;
  }

  const body = builder.toBulkUpsert().lifecycle;
  const type = transaction.transactionTypeUrn;
  for (const step of itemsOfType(type, body?.steps)) {
    if (
      step.transactionUrn === transaction.urn &&
      step.labels?.[STATE_LABEL] === state &&
      !steps.some((s) => s.name === step.name)
    ) {
      steps.push({ name: step.name, status: "pending" });
    }
  }
  const started = new Set(itemsOfType(type, body?.stepStarts).map((i) => i.stepUrn));
  return steps.map((s) =>
    started.has(stepUrn(transaction, s.name)) ? { ...s, status: "started" } : s,
  );
}

/** The items one transaction type's groups hold in a lifecycle body section. */
function itemsOfType<T>(
  transactionTypeUrn: string,
  sections: { transactionTypeUrn: string; items: T[] }[] = [],
): T[] {
  return sections
    .filter((s) => s.transactionTypeUrn === transactionTypeUrn)
    .flatMap((s) => s.items);
}

// ---------------------------------------------------------------------------
// Conditions

/** The condition a `condition-signaled` event reports a signal for. */
export function conditionOf(transition: TransitionInput): Condition {
  const { transaction, event } = transition;
  const condition = transaction.conditions?.find((c) => c.urn === event.subjectUrn);
  if (!condition) {
    throw new Error(`${event.urn} names no condition of ${transaction.urn}`);
  }
  return condition;
}

// ---------------------------------------------------------------------------
// The machine

/** The result of evaluating an event. */
export interface EvaluationResult {
  /** The transaction's state before the event. */
  from: string;
  /** The transaction's state after the event (the same as `from` when it stays). */
  to: string;
  /** The rows to write, including the state label. */
  body: BulkUpsertInput;
}

/** The special state that matches every non-final state. */
const ANY = "*";

/**
 * The state machine for one transaction type, driven by its lifecycle
 * events. A transaction's state is stored in its `state` label.
 *
 * For each event, the transitions of the current state are tried in order,
 * then those of the `*` state (unless the current state is final). The first
 * that does not "pass" handles the event: it adds the rows to write, and can
 * take the transaction to a new state.
 *
 * A state's `steps` list every step a transaction may do in it, in order. A
 * transaction's steps are added, pending, when the handler knows they will
 * happen, and started when they are ready to be done.
 */
export class StateMachine<Config = unknown> {
  private readonly transitions: Transition<Config>[];
  private readonly definedSteps: Set<string>;
  private readonly options: Required<StateMachineOptions>;

  /**
   * Initialize the state machine.
   * Throws when a transition names an invalid state or event.
   */
  constructor(readonly def: StateMachineDef<Config>) {
    this.options = { ...DEFAULT_OPTIONS, ...def.options };
    this.transitions = transitionsOf(def);
    this.definedSteps = new Set(Object.values(def.states).flatMap((s) => s.steps ?? []));
    const known = new Set([...Object.keys(def.states), ...def.final]);
    for (const { state, eventKey, to } of this.transitions) {
      const validKey = splitName(eventKey)?.parts.every(
        (part) => part === "*" || (part && !part.includes("*")),
      );
      if (!validKey) {
        throw new Error(`Transition ${state} on ${eventKey}: invalid event key`);
      }
      const unknown = to.filter((target) => target === ANY || !known.has(target));
      if (unknown.length > 0) {
        throw new Error(
          `Transition ${state} on ${eventKey}: goes to unknown state ${unknown.join(", ")}`,
        );
      }
    }
  }

  /**
   * Whether the machine may act on the given event: a transition matches it,
   * or, with `autoStartSteps`, it is the outcome of any defined step.
   */
  handles(event: LifecycleEvent): boolean {
    if (this.transitions.some(({ eventKey }) => matchesKey(eventKey, event.name))) {
      return true;
    }
    if (this.options.autoStartSteps && event.eventType === "step-outcome") {
      const step = splitName(event.name)?.parts[0];
      return step !== undefined && this.definedSteps.has(step);
    }
    return false;
  }

  /**
   * Evaluate an event for its transaction: the transition that handles it, then, with
   * `autoStartSteps`, the steps rule for the state the transaction is in or
   * goes to, then the state label, as one body.
   */
  async evaluate(
    ctx: EvaluationContext<Config>,
    transaction: Transaction,
    event: LifecycleEvent,
  ): Promise<EvaluationResult | undefined> {
    const input: TransitionInput = {
      transaction,
      state: transaction.labels?.[STATE_LABEL] ?? this.def.initial,
      event,
    };
    const { builder, state } = await this.transition(ctx, input);
    if (this.options.autoStartSteps) {
      startNextStep({ ...ctx, builder, def: this.def }, input, state);
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
    return {
      from: input.state,
      to: state,
      body: builder.toBulkUpsert(),
    };
  }

  /**
   * Run the transitions that match the event, each with a fresh builder,
   * until one handles it (does not pass). Returns that transition's builder
   * and the state it goes to, or an empty builder and the current state when
   * none handles it. A `go` to a state outside the transition's `to` list is
   * an error.
   */
  private async transition(
    ctx: EvaluationContext<Config>,
    input: TransitionInput,
  ): Promise<{ builder: BulkUpsertBuilder; state: string }> {
    const name = input.event.name;
    const matches = [...this.matchesIn(input.state, name), ...this.anyMatches(input.state, name)];
    for (const { eventKey, to, run } of matches) {
      const builder = transitionBuilder();
      const next = await run({ ...ctx, builder, def: this.def }, input);
      if (next.action === "pass") {
        continue;
      }
      const state = next.action === "go" ? next.state : input.state;
      if (state !== input.state && !to.includes(state)) {
        throw new Error(
          `Transition ${input.state} on ${eventKey}: went to ${state}, which is not in its to: ${to.join(", ")}`,
        );
      }
      return { builder, state };
    }
    return { builder: transitionBuilder(), state: input.state };
  }

  /**
   * A mermaid `stateDiagram-v2` of the machine: one arrow per source and
   * target, labeled with the event keys that take it, and under each state
   * its steps. The `*` state is drawn as one "any state" node.
   */
  mermaid(): string {
    const node = (state: string) => (state === ANY ? "anyState" : state);

    const eventKeysByArrow = new Map<string, string[]>();
    const reached = new Set<string>();
    for (const { state, eventKey, to } of this.transitions) {
      for (const target of to) {
        const arrow = `${node(state)} --> ${target}`;
        eventKeysByArrow.set(arrow, [...(eventKeysByArrow.get(arrow) ?? []), eventKey]);
        reached.add(target);
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
    for (const [state, { steps = [] }] of Object.entries(this.def.states)) {
      if (state !== ANY && steps.length > 0) {
        lines.push(`    ${state}: ${steps.join("<br/>")}`);
      }
    }
    return lines.join("\n");
  }

  /** The transitions of one table that match an event, in declaration order. */
  private matchesIn(table: string, eventName: string): Transition<Config>[] {
    return this.transitions.filter(
      ({ state, eventKey }) => state === table && matchesKey(eventKey, eventName),
    );
  }

  /** The `*` state's matches, which apply in every state but the final ones. */
  private anyMatches(state: string, eventName: string): Transition<Config>[] {
    return this.def.final.includes(state) ? [] : this.matchesIn(ANY, eventName);
  }
}

// ---------------------------------------------------------------------------
// Event handling

/**
 * For each event in order that one of the machines handles, read its
 * transaction, evaluate it with the first machine whose transaction filter
 * accepts the transaction, and write the result. An event whose transaction
 * is not found, or that no machine's filter accepts, is skipped.
 */
export async function handleEvents<Config>(
  ctx: EvaluationContext<Config> & { subledger: SubledgerWriter },
  machines: StateMachine<Config>[],
  events: LifecycleEvent[],
): Promise<void> {
  for (const event of events) {
    if (!machines.some((m) => m.handles(event))) {
      continue;
    }
    const transaction = await readTransaction(ctx.subledger, event);
    if (!transaction) {
      log.warn(`${event.transactionUrn} not found; skipping ${event.name}`);
      continue;
    }
    const machine = machines.find(
      (m) => m.def.transactionFilter === undefined || m.def.transactionFilter(transaction),
    );
    if (!machine) {
      log.warn(`No state machine drives ${transaction.urn}; skipping ${event.name}`);
      continue;
    }
    const result = await machine.evaluate(ctx, transaction, event);
    if (result) {
      log.info(`${transaction.name} ${event.name}: ${result.from} -> ${result.to}`);
      await ctx.subledger.bulkUpsert(result.body);
    }
  }
}

// ---------------------------------------------------------------------------
// Internals

/** Split an event name or key into its type and parts, or undefined if it fits no format. */
function splitName(name: string): { type: string; parts: string[] } | undefined {
  const [type, ...segments] = name.split(".");
  switch (NAME_PARTS[type as LifecycleEvent["eventType"]]) {
    case 0:
      // <type>
      return segments.length === 0 ? { type, parts: [] } : undefined;
    case 1:
      // <type>.<member>, where the member's name may contain dots
      return segments.length >= 1 ? { type, parts: [segments.join(".")] } : undefined;
    case 2: {
      // condition-signaled.<condition>.<signal id>, where the signal id has no dots
      const signalId = segments.pop();
      return segments.length >= 1 && signalId
        ? { type, parts: [segments.join("."), signalId] }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Whether an event key matches an event name: part by part, `*` standing for any whole part. */
export function matchesKey(eventKey: string, eventName: string): boolean {
  const key = splitName(eventKey);
  const name = splitName(eventName);
  return (
    !!key &&
    !!name &&
    key.type === name.type &&
    key.parts.every((part, i) => part === "*" || part === name.parts[i])
  );
}

/** A transition as the machine reads it: the state it leaves, its event name, and its entry. */
interface Transition<Config = unknown> extends TransitionEntry<Config> {
  state: string;
  eventKey: string;
}

/**
 * Every transition of a definition: the state it leaves, its event name, and
 * its entry. A bare `go` is an entry whose `to` is its target.
 */
function transitionsOf<Config>(def: StateMachineDef<Config>): Transition<Config>[] {
  return Object.entries(def.states).flatMap(([state, { on = {} }]) =>
    Object.entries(on).flatMap(([eventKey, transition]) => {
      if (transition === undefined) {
        return [];
      }
      return [{ state, eventKey, ...entryOf(transition) }];
    }),
  );
}

/** The entry for a transition: itself, or for a fixed move, an entry whose `to` is its target. */
function entryOf<Config>(transition: TransitionEntry<Config> | Go): TransitionEntry<Config> {
  return "run" in transition ? transition : { to: [transition.state], run: () => transition };
}

/** A builder for one transition, with writes disabled: the caller of `evaluate` writes the body. */
function transitionBuilder(): BulkUpsertBuilder {
  const noWrites: IBulkUpsertClient = {
    bulkUpsert: () =>
      Promise.reject(new Error("a transition's builder cannot be executed directly")),
  };
  return new BulkUpsertBuilder(noWrites, {
    defaults: { updateStrategy: "create_or_ignore", labelStrategy: "create_or_update" },
  });
}

/** Read an event's transaction, with its children. */
export async function readTransaction(
  client: SubledgerReader,
  event: LifecycleEvent,
): Promise<Transaction | undefined> {
  const out = await client.bulkQuery({
    lifecycle: {
      transactions: [
        {
          transactionTypeUrn: root(event.transactionUrn),
          equal: [{ field: "urn", value: event.transactionUrn }],
          limit: 1,
        },
      ],
    },
    options: { includeChildren: true },
  });
  return out.lifecycle?.transactions?.[0]?.items?.[0];
}
