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
  StepOutcomeInput,
  Transaction,
  TransactionOutcomeInput,
} from "../schema.js";
import { SubledgerClient } from "../subledger.js";

const log = newLogger("subledger-state-machine");

// ---------------------------------------------------------------------------
// Type aliases

/** An event in a transaction's lifecycle, as the processor's stream delivers it. */
export type LifecycleEvent = Event;

/** The part of the subledger client that reads. */
export type SubledgerReader = Pick<SubledgerClient, "bulkQuery">;

/** The part of the subledger client that writes. */
export type SubledgerWriter = Pick<SubledgerClient, "bulkUpsert">;

// ---------------------------------------------------------------------------
// Labels the machine writes

/** The label that holds the state of a transaction, and the state each step was added in. */
export const STATE_LABEL = "state";

/** The transaction label that holds the states expected to follow its current state, comma-separated. */
export const EXPECTED_STATES_LABEL = "expectedStates";

/** The transaction label that holds the states it has left, in order, comma-separated. */
export const PREVIOUS_STATES_LABEL = "previousStates";

/** The transaction label that holds the steps chosen for it in its current state, in order, comma-separated. */
export const PLANNED_STEPS_LABEL = "plannedSteps";

// ---------------------------------------------------------------------------
// Definitions

/** The state machine definition. */
export interface StateMachineDef<Config = unknown> {
  /** The transition a transaction takes on its first evaluation. */
  initial: InitialTransition<Config> | Go;
  /** Every state, simple and final, in display order. */
  states: Record<string, StateDef<Config>>;
  /** Transitions that apply in every non-final state, after the state's own. */
  on?: StateTransitions<Config>;
  /** Whether the machine drives a transaction, for hosts that run several machines. Defaults to every transaction. */
  transactionFilter?: (transaction: Transaction) => boolean;
  /** Options for how the machine runs. */
  options?: StateMachineOptions<Config>;
}

/** Options for how a state machine runs. */
export interface StateMachineOptions<Config = unknown> {
  /**
   * Predicts the states a transaction is expected to pass through after entering
   * `state`. Defaults to `findExpectedStates`. This is not a promise, only a
   * prediction (for instance, to help with UI rendering of future states).
   */
  expectedStates?: (input: ExpectedStatesInput<Config>) => string[];
  /**
   * Adds labels or info to every step before the machine writes it. Runs after
   * the step's own `prepare`. It cannot rename or otherwise modify the step.
   */
  prepareStep?: (step: NewStep, input: PrepareStepInput) => NewStep;
}

/** The input to `StateMachineOptions.expectedStates`. */
export interface ExpectedStatesInput<Config = unknown> {
  definition: StateMachineDef<Config>;
  state: string;
  transaction: Transaction;
  /** The transaction as this evaluation has updated it so far. */
  updatedTransaction: TransactionView;
}

/** The input to `StateMachineOptions.prepareStep`. */
export interface PrepareStepInput {
  transaction: Transaction;
  state: string;
  /** The transaction as this evaluation has updated it so far. */
  updatedTransaction: TransactionView;
}

/** A step as the machine writes it. */
export interface NewStep {
  name: string;
  labels?: Record<string, string>;
  info?: unknown;
}

// ---------------------------------------------------------------------------
// States

/** One state of a machine: a simple state, or a final state. */
export type StateDef<Config = unknown> = SimpleStateDef<Config> | FinalStateDef;

/**
 * A state a transaction passes through. A state with steps runs them in
 * order, then moves on through `then`; a state without steps only waits
 * for an event in `on`.
 */
export interface SimpleStateDef<Config = unknown> {
  type?: "simple";
  /** The steps the state may run, in order. */
  steps?: StepDef<Config>[];
  /** Runs after the last chosen step completes, or on entry when no step is chosen. */
  then?: TransitionEntry<Config> | Next;
  /** Transitions on events, by event key. */
  on?: StateTransitions<Config>;
}

/** A state that concludes the transaction with `outcome` on entry. It has no steps or transitions. */
export interface FinalStateDef {
  type: "final";
  outcome: TransactionOutcomeInput["status"];
}

// ---------------------------------------------------------------------------
// Step definitions

/** A step of a state: a name alone, or an object that names it with additional config. */
export type StepDef<Config = unknown> =
  | string
  | {
      name: string;
      /** Whether the transaction runs the step. Without it, the step always runs. Evaluated at state entry. */
      when?: WhenFn;
      /** Gives the step its labels and info. Runs when the machine adds the step. */
      prepare?: PrepareFn<Config>;
    };

/** Whether a transaction runs a step, asked once on entering the step's state. */
export type WhenFn = (input: WhenInput) => boolean;

/** The input to a step's `when`. */
export interface WhenInput {
  /** The transaction as it was before the event's evaluation. */
  transaction: Transaction;
  /** The state the transaction moved from; unset for the state its initial transition enters. */
  from?: string;
  /** The transaction as this evaluation has updated it so far. */
  updatedTransaction: TransactionView;
  /** The states the transaction has left, in order, including those passed in this evaluation. */
  previousStates: string[];
}

/** Gives a step its labels and info, when the machine adds the step. */
export type PrepareFn<Config = unknown> = (
  ctx: EvaluationContext<Config>,
  input: PrepareInput,
) => StepData | Promise<StepData>;

/** The input to a step's `prepare`. */
export interface PrepareInput {
  /** The transaction as it was before the event's evaluation. */
  transaction: Transaction;
  /** The state the step is added in. */
  state: string;
  /** The event being evaluated: the one that moved the transaction into the state, or the outcome of the state's previous step. */
  event: LifecycleEvent;
  /** The transaction as this evaluation has updated it so far. */
  updatedTransaction: TransactionView;
}

/** The labels and info a step's `prepare` gives it. */
export type StepData = Pick<NewStep, "labels" | "info">;

// ---------------------------------------------------------------------------
// Transitions

/** Transitions out of one state, by event key. */
export type StateTransitions<Config = unknown> = Partial<
  Record<EventKey, TransitionEntry<Config> | Next>
>;

/**
 * An event key: a lifecycle event name in which `*` may stand for a whole
 * segment. `step-outcome.notify` matches that event, `step-outcome.*` any
 * step's outcome, `condition-signaled.mint.*` every signal meeting the `mint`
 * condition.
 */
export type EventKey =
  | "transaction-outcome"
  | `${"step-added" | "step-started" | "step-outcome" | "leg-added" | "condition-added"}.${string}`
  | `condition-signaled.${string}.${string}`;

/** A transition on an event: one that may move the transaction, or one that only stays or passes. */
export type TransitionEntry<Config = unknown> =
  | MovingTransition<Config>
  | StayingTransition<Config>;

/** A transition that may move the transaction. */
export interface MovingTransition<Config = unknown> {
  /** The states the transition may move the transaction to. */
  to: string[];
  /** Decides the transition: a move to one of `to`, a stay or a pass. */
  run: TransitionFn<Config, Next>;
}

/** A transition that always stays or passes. */
export interface StayingTransition<Config = unknown> {
  to?: undefined;
  /** Decides the transition: a stay or a pass. */
  run: TransitionFn<Config, Stay | Pass>;
}

/** The transition a transaction takes on its first evaluation, on its `transaction-accepted` event. */
export interface InitialTransition<Config = unknown> {
  /** The states the transaction may enter first. */
  to: string[];
  /** Decides the transition: a move to one of `to`. */
  run: (ctx: TransitionContext<Config>, input: InitialInput) => Go | Promise<Go>;
}

/** The function that decides a transition: it adds the rows to write, and returns what happens next. */
export type TransitionFn<Config, Result extends Next> = (
  ctx: TransitionContext<Config>,
  input: TransitionInput,
) => Result | Promise<Result>;

/** The environment the caller of `evaluate` supplies. */
export interface EvaluationContext<Config = unknown> {
  /** The handler's config. */
  config: Config;
  /** Reads the subledger. */
  subledger: SubledgerReader;
}

/** The environment a transition runs in. */
export interface TransitionContext<Config = unknown> extends EvaluationContext<Config> {
  /** Holds the rows the transition writes, which the caller of `evaluate` writes. */
  builder: BulkUpsertBuilder;
  /** The machine's definition. */
  def: StateMachineDef<Config>;
}

/** The input to a transition. */
export interface TransitionInput {
  /** The transaction with its children, as read before the event. */
  transaction: Transaction;
  /** The transaction's current state. */
  state: string;
  /** The event being evaluated. */
  event: LifecycleEvent;
  /** The transaction as this evaluation has updated it so far. */
  updatedTransaction: TransactionView;
}

/** The input to the initial transition: a transition's input, before the transaction has a state. */
export type InitialInput = Omit<TransitionInput, "state" | "updatedTransaction">;

/**
 * The parts of a transaction that an evaluation updates, as updated so far.
 * Hooks decide from it, and read `transaction` for data fixed when the
 * transaction was created.
 */
export interface TransactionView {
  /** The transaction's labels, with those written earlier in this evaluation applied. */
  labels: Record<string, string>;
  /** The names of the transaction's legs, including those added earlier in this evaluation. */
  legs: string[];
}

// ---------------------------------------------------------------------------
// Results

/** What a transition returns: move to a state, stay, or pass the event to the next matching transition. */
export type Next = Go | Stay | Pass;

/** A move to `state`. */
export interface Go {
  action: "go";
  state: string;
  /** The transaction's outcome, for a move to a final state. */
  outcome?: TransactionOutcomeDef;
}

/** The outcome of a transaction, as a move to a final state writes it. Its `causationUrn` defaults to the event. */
export type TransactionOutcomeDef = Omit<TransactionOutcomeInput, "transactionUrn" | "status">;

/** Keeping the current state. */
export interface Stay {
  action: "stay";
}

/** Passing the event to the next matching transition. */
export interface Pass {
  action: "pass";
}

/** Move to `state`, writing `outcome` when it is a final state. */
export function go(state: string, outcome?: TransactionOutcomeDef): Go {
  return { action: "go", state, ...(outcome && { outcome }) };
}

/** Keep the current state. */
export function stay(): Stay {
  return { action: "stay" };
}

/** Pass the event to the next matching transition. */
export function pass(): Pass {
  return { action: "pass" };
}

// ---------------------------------------------------------------------------
// Step outcome transitions

/**
 * Wrap a step outcome's transition to run only when the step outcome
 * is "completed".
 */
export function ifCompleted<Config = unknown>(
  transition: MovingTransition<Config> | Go,
): MovingTransition<Config>;
export function ifCompleted<Config = unknown>(
  transition: StayingTransition<Config> | Stay | Pass,
): StayingTransition<Config>;
export function ifCompleted<Config = unknown>(
  transition: TransitionEntry<Config> | Next,
): TransitionEntry<Config> {
  return ifStepStatus("completed", transition);
}

/**
 * Wrap a step outcome's transition to run only when the step outcome
 * is "failed".
 */
export function ifFailed<Config = unknown>(
  transition: MovingTransition<Config> | Go,
): MovingTransition<Config>;
export function ifFailed<Config = unknown>(
  transition: StayingTransition<Config> | Stay | Pass,
): StayingTransition<Config>;
export function ifFailed<Config = unknown>(
  transition: TransitionEntry<Config> | Next,
): TransitionEntry<Config> {
  return ifStepStatus("failed", transition);
}

/** Wraps a transition to run only when the step whose outcome is the event has `status`. */
function ifStepStatus<Config>(
  status: StepOutcomeInput["status"],
  transition: TransitionEntry<Config> | Next,
): TransitionEntry<Config> {
  const check =
    <Result extends Next>(run: TransitionFn<Config, Result>): TransitionFn<Config, Result | Pass> =>
    (ctx, input) => {
      const { transaction, event } = input;
      const step = transaction.steps?.find((s) => s.urn === event.subjectUrn);
      return step?.status === status ? run(ctx, input) : pass();
    };
  const entry = entryOf(transition);
  return entry.to === undefined
    ? { run: check(entry.run) }
    : { to: entry.to, run: check(entry.run) };
}

// ---------------------------------------------------------------------------
// Steps

/** The URN of the transaction's step named `step`. */
export function stepUrn(transaction: Transaction, step: string): string {
  return `${transaction.urn}:step=${step}`;
}

/** The outcome of a step, as `concludeStep` writes it. */
export type StepOutcomeDef = Omit<StepOutcomeInput, "stepUrn">;

/**
 * Concludes one of the transaction's steps, caused by the event unless the
 * outcome names its cause.
 */
export function concludeStep<Config>(
  ctx: TransitionContext<Config>,
  input: Pick<TransitionInput, "transaction" | "event">,
  step: string,
  outcome: StepOutcomeDef,
): void {
  const { transaction, event } = input;
  ctx.builder.lifecycle.add({
    stepOutcomes: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ causationUrn: event.urn, ...outcome, stepUrn: stepUrn(transaction, step) }],
      },
    ],
  });
}

/** The name of a step a state declares. */
export function stepNameOf<Config>(step: StepDef<Config>): string {
  return typeof step === "string" ? step : step.name;
}

// ---------------------------------------------------------------------------
// Conditions

/** The condition a `condition-signaled` event reports a signal for. */
export function conditionOf(transition: Pick<TransitionInput, "transaction" | "event">): Condition {
  const { transaction, event } = transition;
  const condition = transaction.conditions?.find((c) => c.urn === event.subjectUrn);
  if (!condition) {
    throw new Error(`${event.urn} names no condition of ${transaction.urn}`);
  }
  return condition;
}

// ---------------------------------------------------------------------------
// Expected states

/** The states reachable from `state` through the transitions' `to` lists, excluding `state` itself. */
export function reachableStates<Config>(def: StateMachineDef<Config>, state: string): Set<string> {
  const reached = new Set<string>();
  const queue = [state];
  while (queue.length > 0) {
    for (const next of successorsOf(def, queue.shift()!)) {
      if (next !== state && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

/**
 * Whether a completed final state is reachable from `state`. A state in
 * `ignore` never counts as a way to complete, nor does any path through it.
 */
export function canComplete<Config>(
  def: StateMachineDef<Config>,
  state: string,
  options: { ignore?: string[] } = {},
): boolean {
  return completableStates(def, options.ignore ?? []).has(state);
}

/**
 * Lists the states a transaction in `state` is expected to pass through, in
 * declared order: from a state that can complete, the reachable states that
 * can also complete; from one that cannot, the reachable states that cannot.
 */
export function findExpectedStates<Config>(
  def: StateMachineDef<Config>,
  state: string,
  options: { ignore?: string[] } = {},
): string[] {
  const completable = completableStates(def, options.ignore ?? []);
  const reached = reachableStates(def, state);
  const completes = completable.has(state);
  return declaredStates(def).filter((s) => reached.has(s) && completable.has(s) === completes);
}

/** The states from which a completed final state is reachable, never through one in `ignore`. */
function completableStates<Config>(def: StateMachineDef<Config>, ignore: string[]): Set<string> {
  const states = Object.entries(def.states);
  const completable = new Set(
    states.filter(([, s]) => s.type === "final" && s.outcome === "completed").map(([name]) => name),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [state] of states) {
      if (
        !completable.has(state) &&
        !ignore.includes(state) &&
        successorsOf(def, state).some((next) => completable.has(next))
      ) {
        completable.add(state);
        grew = true;
      }
    }
  }
  return completable;
}

/** The targets of a state's `then`, its transitions and the machine's own; none for a final state. */
function successorsOf<Config>(def: StateMachineDef<Config>, state: string): string[] {
  const stateDef = simpleStateOf(def, state);
  if (!stateDef) {
    return [];
  }
  return [...thenOf(stateDef), ...transitionsOf(stateDef.on), ...transitionsOf(def.on)].flatMap(
    ({ to }) => to,
  );
}

/** Every state in declared order. */
function declaredStates<Config>(def: StateMachineDef<Config>): string[] {
  return Object.keys(def.states);
}

/** The simple state named `state`, or undefined for a final or unknown state. */
function simpleStateOf<Config>(
  def: StateMachineDef<Config>,
  state: string,
): SimpleStateDef<Config> | undefined {
  const stateDef = def.states[state];
  return stateDef && stateDef.type !== "final" ? stateDef : undefined;
}

/** The names of the steps a simple state declares; none for a final or unknown state. */
function stepsOf<Config>(def: StateMachineDef<Config>, state: string): string[] {
  return (simpleStateOf(def, state)?.steps ?? []).map(stepNameOf);
}

/** A state's `then` as a transition keyed "then", or none. */
function thenOf<Config>(stateDef: SimpleStateDef<Config>): Transition<Config>[] {
  return stateDef.then === undefined ? [] : [transitionOf("then", stateDef.then)];
}

// ---------------------------------------------------------------------------
// The machine

/** The result of evaluating an event. */
export interface EvaluationResult {
  /** The transaction's state before the event; unset on its first evaluation. */
  from?: string;
  /** The transaction's state after the event (the same as `from` when it stays). */
  to: string;
  /** The rows to write, including the state labels. */
  body: BulkUpsertInput;
}

/** Define a transaction type's state machine. `Config` is the type of the handler's config. */
export function stateMachine<Config = unknown>(def: StateMachineDef<Config>): StateMachine<Config> {
  return new StateMachine(def);
}

/**
 * The state machine for one transaction type, driven by its lifecycle
 * events. A transaction's state is stored in its `state` label.
 *
 * A transaction's first evaluation, on its `transaction-accepted` event,
 * takes the initial transition into its first state. For each later event,
 * the transitions of the current state are tried in order, then the
 * machine's own. The first that does not "pass" handles the event: it adds
 * the rows to write, and moves the transaction or stays. A transaction in a
 * final state handles no events.
 *
 * Entering a state records it with the states left before it and the states
 * expected to follow, and chooses its steps through their `when`s. The
 * chosen steps run one at a time, in order: each is added when the one
 * before it completes. After the last, or on entry when none is chosen, the
 * state's `then` runs. Entering a final state concludes the transaction.
 */
export class StateMachine<Config = unknown> {
  /** The initial transition. */
  private readonly initial: InitialTransition<Config>;
  /** Each simple state's transitions, in declaration order. */
  private readonly byState: Map<string, Transition<Config>[]>;
  /** The machine's own transitions, which apply in every non-final state. */
  private readonly anyState: Transition<Config>[];
  /** The transaction status each final state concludes with. */
  private readonly finalStatus: Map<string, TransactionOutcomeInput["status"]>;

  /**
   * Initialize the state machine. Throws when the definition is invalid.
   */
  constructor(readonly def: StateMachineDef<Config>) {
    const { initial } = def;
    this.initial = "action" in initial ? { to: [initial.state], run: () => initial } : initial;
    this.byState = new Map(
      Object.keys(def.states).flatMap((state) => {
        const stateDef = simpleStateOf(def, state);
        return stateDef ? [[state, transitionsOf(stateDef.on)] as const] : [];
      }),
    );
    this.anyState = transitionsOf(def.on);
    this.finalStatus = new Map(
      Object.entries(def.states).flatMap(([state, s]) =>
        s.type === "final" ? [[state, s.outcome] as const] : [],
      ),
    );
    this.validate();
  }

  /**
   * Throws when the initial transition goes to no state or to an unknown
   * one, a final state declares steps or transitions, a state has steps
   * without a `then` or a `then` without steps, a state declares a step
   * twice, or a transition has an invalid event key or target.
   */
  private validate() {
    const known = new Set(Object.keys(this.def.states));
    if (this.initial.to.length === 0) {
      throw new Error("The initial transition goes to no state");
    }
    const unknown = this.initial.to.filter((target) => !known.has(target));
    if (unknown.length > 0) {
      throw new Error(`The initial transition goes to unknown state ${unknown.join(", ")}`);
    }
    for (const [state, stateDef] of Object.entries(this.def.states)) {
      if (
        stateDef.type === "final" &&
        ("steps" in stateDef || "on" in stateDef || "then" in stateDef)
      ) {
        throw new Error(`Final state ${state} declares steps or transitions`);
      }
    }
    for (const [state, transitions] of this.byState) {
      const stateDef = simpleStateOf(this.def, state)!;
      const steps = stepsOf(this.def, state);
      if (steps.length > 0 && stateDef.then === undefined) {
        throw new Error(`State ${state} has steps and no then`);
      }
      if (steps.length === 0 && stateDef.then !== undefined) {
        throw new Error(`State ${state} has a then and no steps`);
      }
      if (new Set(steps).size !== steps.length) {
        throw new Error(`State ${state} declares a step twice`);
      }
      checkTransitions(state, [...thenOf(stateDef), ...transitions], known);
    }
    checkTransitions("any state", this.anyState, known);
  }

  /**
   * Whether the machine may act on the given event: a transaction's
   * creation, the outcome of a step a state declares, or an event a
   * transition matches.
   */
  handles(event: LifecycleEvent): boolean {
    if (event.eventType === "transaction-accepted") {
      return true;
    }
    const declared = [...this.byState.keys()].flatMap((state) => stepsOf(this.def, state));
    if (declared.some((step) => event.name === `step-outcome.${step}`)) {
      return true;
    }
    const transitions = [...this.byState.values(), this.anyState].flat();
    return transitions.some(({ eventKey }) => matchesKey(eventKey, event.name));
  }

  /**
   * Evaluate an event for its transaction: the transition that handles it,
   * then the next of the state's steps when the event completes one, and on
   * a move, the entry into the state the transaction ends in, as one body. An
   * active transaction with no state takes the initial transition on its
   * `transaction-accepted` event, and ignores every other event.
   */
  async evaluate(
    ctx: EvaluationContext<Config>,
    transaction: Transaction,
    event: LifecycleEvent,
  ): Promise<EvaluationResult | undefined> {
    const recorded = transaction.labels?.[STATE_LABEL];
    if (recorded === undefined) {
      return event.eventType === "transaction-accepted" && transaction.status === "active"
        ? this.start(ctx, transaction, event)
        : undefined;
    }
    const input: Moment = { transaction, state: recorded, event };
    if (this.finalStatus.has(input.state)) {
      return undefined; // no transition from final states
    }
    if (!this.byState.has(input.state)) {
      log.warn(`${transaction.urn} is in state ${input.state}, which the machine does not define`);
      return undefined;
    }
    const { builder, next } = await this.transition(ctx, input);
    const moved = next.action === "go" && next.state !== input.state;
    const after = moved ? next : await this.advance(ctx, builder, input);
    if (after?.action !== "go" || after.state === input.state) {
      return builder.hasUpdates()
        ? { from: recorded, to: recorded, body: builder.toBulkUpsert() }
        : undefined;
    }
    const to = await this.enter(ctx, builder, input, { ...after, from: recorded });
    return { from: recorded, to, body: builder.toBulkUpsert() };
  }

  /** Take the initial transition, and enter the state it goes to. */
  private async start(
    ctx: EvaluationContext<Config>,
    transaction: Transaction,
    event: LifecycleEvent,
  ): Promise<EvaluationResult> {
    const builder = transitionBuilder();
    const next = await this.initial.run({ ...ctx, builder, def: this.def }, { transaction, event });
    if (next.action !== "go" || !this.initial.to.includes(next.state)) {
      throw new Error(
        `The initial transition must go to one of ${this.initial.to.join(", ")}; returned ${JSON.stringify(next)}`,
      );
    }
    const to = await this.enter(ctx, builder, { transaction, state: next.state, event }, next);
    return { from: undefined, to, body: builder.toBulkUpsert() };
  }

  /**
   * Run the transitions that match the event, each with a fresh builder,
   * until one handles it (does not pass). Returns that transition's builder
   * and result, or an empty builder and a stay when none handles it.
   */
  private async transition(
    ctx: EvaluationContext<Config>,
    input: Moment,
  ): Promise<{ builder: BulkUpsertBuilder; next: Go | Stay }> {
    const thisState = this.byState.get(input.state) ?? [];
    const matches = [...thisState, ...this.anyState].filter(({ eventKey }) =>
      matchesKey(eventKey, input.event.name),
    );
    for (const transition of matches) {
      const builder = transitionBuilder();
      const next = await this.run(ctx, builder, input, transition);
      if (next.action !== "pass") {
        return { builder, next };
      }
    }
    return { builder: transitionBuilder(), next: stay() };
  }

  /** Run one transition, with the transaction as the builder has updated it. A `go` to a state outside its `to` list is an error. */
  private async run(
    ctx: EvaluationContext<Config>,
    builder: BulkUpsertBuilder,
    input: Moment,
    { eventKey, to, run }: Transition<Config>,
  ): Promise<Next> {
    const updatedTransaction = updatedTransactionOf(input.transaction, builder);
    const next = await run({ ...ctx, builder, def: this.def }, { ...input, updatedTransaction });
    if (next.action === "go" && next.state !== input.state && !to.includes(next.state)) {
      throw new Error(
        `Transition ${input.state} on ${eventKey}: went to ${next.state}, which is not in its to: ${to.join(", ")}`,
      );
    }
    return next;
  }

  /**
   * When the event is the completed outcome of one of the steps chosen in
   * the current state, add the next chosen step, or after the last run the
   * state's `then`. Returns what `then` returned, if it ran.
   */
  private async advance(
    ctx: EvaluationContext<Config>,
    builder: BulkUpsertBuilder,
    input: Moment,
  ): Promise<Next | undefined> {
    const { transaction, state, event } = input;
    if (event.eventType !== "step-outcome") {
      return undefined;
    }
    const step = transaction.steps?.find((s) => s.urn === event.subjectUrn);
    const planned = listOf(transaction.labels?.[PLANNED_STEPS_LABEL]);
    const at = step ? planned.indexOf(step.name) : -1;
    if (step?.status !== "completed" || step.labels?.[STATE_LABEL] !== state || at < 0) {
      return undefined;
    }
    if (at + 1 < planned.length) {
      await this.writeStep(ctx, builder, input, state, planned[at + 1]);
      return undefined;
    }
    return this.runThen(ctx, builder, input);
  }

  /** Run the state's `then`; a pass is a stay. */
  private async runThen(
    ctx: EvaluationContext<Config>,
    builder: BulkUpsertBuilder,
    input: Moment,
  ): Promise<Next> {
    const [then] = thenOf(simpleStateOf(this.def, input.state)!);
    return this.run(ctx, builder, input, then);
  }

  /**
   * Enter the state a move goes to, and each state passed through from it:
   * a state whose steps are all left out by their `when`s runs its `then` on
   * entry. Labels the transaction once, for the state it ends in, and adds
   * that state's first chosen step, or concludes the transaction for a final
   * state. Returns the state it ends in.
   */
  private async enter(
    ctx: EvaluationContext<Config>,
    builder: BulkUpsertBuilder,
    input: Moment,
    first: Go & { from?: string },
  ): Promise<string> {
    const { transaction, event } = input;
    let previousStates = listOf(transaction.labels?.[PREVIOUS_STATES_LABEL]);
    let move = first;
    for (let passed = 0; ; passed++) {
      if (passed > this.byState.size) {
        throw new Error(`${transaction.urn} passed through more states than the machine has`);
      }
      const { state, from, outcome } = move;
      if (from !== undefined) {
        previousStates = [...previousStates, from];
      }
      const status = this.finalStatus.get(state);
      if (status) {
        this.label(builder, transaction, state, previousStates, []);
        this.conclude(builder, input, status, outcome);
        return state;
      }
      if (outcome) {
        throw new Error(`The move to ${state} gives an outcome, and ${state} is not a final state`);
      }
      const stateDef = simpleStateOf(this.def, state)!;
      const updatedTransaction = updatedTransactionOf(transaction, builder);
      const planned = (stateDef.steps ?? [])
        .filter(
          (step) =>
            typeof step === "string" ||
            !step.when ||
            step.when({ transaction, updatedTransaction, from, previousStates }),
        )
        .map(stepNameOf);
      const here: Moment = { transaction, state, event };
      if (planned.length > 0 || stateDef.then === undefined) {
        this.label(builder, transaction, state, previousStates, planned);
        if (planned.length > 0) {
          await this.writeStep(ctx, builder, here, state, planned[0]);
        }
        return state;
      }
      const next = await this.runThen(ctx, builder, here);
      if (next.action !== "go" || next.state === state) {
        this.label(builder, transaction, state, previousStates, []);
        return state;
      }
      move = { ...next, from: state };
    }
  }

  /** Label the transaction with its state, the states it has left, the states expected to follow, and its chosen steps. */
  private label(
    builder: BulkUpsertBuilder,
    transaction: Transaction,
    state: string,
    previousStates: string[],
    plannedSteps: string[],
  ) {
    const expected =
      this.def.options?.expectedStates?.({
        definition: this.def,
        state,
        transaction,
        updatedTransaction: updatedTransactionOf(transaction, builder),
      }) ?? findExpectedStates(this.def, state);
    builder.lifecycle.add({
      transactions: [
        {
          transactionTypeUrn: transaction.transactionTypeUrn,
          items: [
            {
              name: transaction.name,
              labels: {
                [STATE_LABEL]: state,
                [PREVIOUS_STATES_LABEL]: previousStates.join(","),
                [EXPECTED_STATES_LABEL]: expected.join(","),
                [PLANNED_STEPS_LABEL]: plannedSteps.join(","),
              },
            },
          ],
        },
      ],
    });
  }

  /** Conclude the transaction with `status` and the move's outcome, caused by the event unless the outcome names its cause. */
  private conclude(
    builder: BulkUpsertBuilder,
    { transaction, event }: Moment,
    status: TransactionOutcomeInput["status"],
    outcome: TransactionOutcomeDef | undefined,
  ) {
    builder.lifecycle.add({
      transactionOutcomes: [
        {
          transactionTypeUrn: transaction.transactionTypeUrn,
          items: [
            {
              causationUrn: event.urn,
              ...outcome,
              transactionUrn: transaction.urn,
              status,
            },
          ],
        },
      ],
    });
  }

  /**
   * Writes the step named `name` to the transaction, labelled with `state`.
   * The step's own `prepare`, then `prepareStep`, give its labels and info.
   * Throws unless `state` declares the step, and when another state already
   * added it.
   */
  private async writeStep(
    ctx: EvaluationContext<Config>,
    builder: BulkUpsertBuilder,
    input: Moment,
    state: string,
    name: string,
  ) {
    const declared = simpleStateOf(this.def, state)?.steps?.find((s) => stepNameOf(s) === name);
    if (!declared) {
      throw new Error(`Step ${name} is not one of the steps of state ${state}`);
    }
    const { transaction, event } = input;
    const planned = transaction.steps?.find((s) => s.name === name);
    if (planned && planned.labels?.[STATE_LABEL] !== state) {
      throw new Error(
        `Step ${name} was added in state ${planned.labels?.[STATE_LABEL]}; it cannot be added again in ${state}`,
      );
    }
    const own =
      typeof declared === "string" || !declared.prepare
        ? {}
        : await declared.prepare(
            { config: ctx.config, subledger: ctx.subledger },
            {
              transaction,
              state,
              event,
              updatedTransaction: updatedTransactionOf(transaction, builder),
            },
          );
    const step: NewStep = { name, ...own };
    const updatedTransaction = updatedTransactionOf(transaction, builder);
    const prepared =
      this.def.options?.prepareStep?.(step, { transaction, state, updatedTransaction }) ?? step;
    if (prepared.name !== step.name) {
      throw new Error(`prepareStep renamed step ${step.name} to ${prepared.name}`);
    }
    const { labels, info } = prepared;
    builder.lifecycle.configure({
      steps: { labelStrategy: "create_or_ignore" },
    });
    builder.lifecycle.add({
      steps: [
        {
          transactionTypeUrn: transaction.transactionTypeUrn,
          items: [
            {
              name: step.name,
              transactionUrn: transaction.urn,
              labels: { ...labels, [STATE_LABEL]: state },
              ...(info !== undefined && { info }),
            },
          ],
        },
      ],
    });
  }

  /**
   * A mermaid `stateDiagram-v2` of the machine: one arrow per source and
   * target, labeled with the event keys that take it or "then", and under
   * each state its steps. The machine's own transitions leave one "any
   * state" node.
   */
  mermaid(): string {
    const eventKeysByArrow = new Map<string, string[]>();
    const reached = new Set<string>();
    const draw = (from: string, transitions: Transition<Config>[]) => {
      for (const { eventKey, to } of transitions) {
        for (const target of to) {
          const arrow = `${from} --> ${target}`;
          eventKeysByArrow.set(arrow, [...(eventKeysByArrow.get(arrow) ?? []), eventKey]);
          reached.add(target);
        }
      }
    };
    for (const [state, transitions] of this.byState) {
      draw(state, [...thenOf(simpleStateOf(this.def, state)!), ...transitions]);
    }
    draw("anyState", this.anyState);

    const lines = ["stateDiagram-v2"];
    if (this.def.on) {
      lines.push('    state "any state" as anyState');
    }
    for (const target of this.initial.to) {
      lines.push(`    [*] --> ${target}`);
    }
    for (const [arrow, eventKeys] of eventKeysByArrow) {
      lines.push(`    ${arrow}: ${eventKeys.join("<br/>")}`);
    }
    for (const state of reached) {
      if (this.finalStatus.has(state)) {
        lines.push(`    ${state} --> [*]`);
      }
    }
    for (const state of this.byState.keys()) {
      const steps = stepsOf(this.def, state);
      if (steps.length > 0) {
        lines.push(`    ${state}: ${steps.join("<br/>")}`);
      }
    }
    return lines.join("\n");
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
      log.info(`${transaction.name} ${event.name}: ${result.from ?? "(new)"} -> ${result.to}`);
      await ctx.subledger.bulkUpsert(result.body);
    }
  }
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

// ---------------------------------------------------------------------------
// Internals

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

/** The items of a comma-separated label; none for an unset or empty one. */
function listOf(label: string | undefined): string[] {
  return label ? label.split(",") : [];
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

/** A transition as the machine reads it: its event key, its targets and its function. */
interface Transition<Config = unknown> {
  eventKey: string;
  to: string[];
  run: TransitionFn<Config, Next>;
}

/** The transitions of an `on` map, in declaration order. */
function transitionsOf<Config>(on: StateTransitions<Config> = {}): Transition<Config>[] {
  return Object.entries(on).flatMap(([eventKey, transition]) =>
    transition === undefined ? [] : [transitionOf(eventKey, transition)],
  );
}

/** A transition as the machine reads it, with no targets when it declares none. */
function transitionOf<Config>(
  eventKey: string,
  transition: TransitionEntry<Config> | Next,
): Transition<Config> {
  const { to, run } = entryOf(transition);
  return { eventKey, to: to ?? [], run };
}

/** Throws when a transition has an invalid event key or goes to a state the machine does not know. */
function checkTransitions<Config>(
  state: string,
  transitions: Transition<Config>[],
  known: Set<string>,
): void {
  for (const { eventKey, to } of transitions) {
    const split = splitName(eventKey);
    const validKey =
      eventKey === "then" ||
      (split?.type !== "transaction-accepted" &&
        split?.parts.every((part) => part === "*" || (part && !part.includes("*"))));
    if (!validKey) {
      throw new Error(`Transition ${state} on ${eventKey}: invalid event key`);
    }
    const unknown = to.filter((target) => !known.has(target));
    if (unknown.length > 0) {
      throw new Error(
        `Transition ${state} on ${eventKey}: goes to unknown state ${unknown.join(", ")}`,
      );
    }
  }
}

/** The entry for a transition: itself, or for a bare result, an entry that returns it. */
function entryOf<Config>(transition: TransitionEntry<Config> | Next): TransitionEntry<Config> {
  if ("run" in transition) {
    return transition;
  }
  if (transition.action === "go") {
    return { to: [transition.state], run: () => transition };
  }
  return { run: () => transition };
}

/** A transition's input before the machine adds the updated transaction. */
type Moment = Omit<TransitionInput, "updatedTransaction">;

/**
 * The transaction's labels and leg names as read, with the labels and legs
 * the builder holds for it applied as the upsert applies them.
 */
function updatedTransactionOf(
  transaction: Transaction,
  builder: BulkUpsertBuilder,
): TransactionView {
  const { lifecycle } = builder.toBulkUpsert();
  const labels: Record<string, string> = { ...transaction.labels };
  const ofType = <T extends { transactionTypeUrn: string }>(entries: T[] = []) =>
    entries.filter((e) => e.transactionTypeUrn === transaction.transactionTypeUrn);
  for (const entry of ofType(lifecycle?.transactions)) {
    const keepStored = entry.labelStrategy === "create_or_ignore";
    for (const item of entry.items.filter((i) => i.name === transaction.name)) {
      for (const [key, value] of Object.entries(item.labels ?? {})) {
        if (!keepStored || !(key in labels)) {
          labels[key] = value;
        }
      }
    }
  }
  const legs = (transaction.legs ?? []).map((l) => l.name);
  for (const entry of ofType(lifecycle?.legs)) {
    for (const item of entry.items.filter((i) => i.transactionUrn === transaction.urn)) {
      if (!legs.includes(item.name)) {
        legs.push(item.name);
      }
    }
  }
  return { labels, legs };
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
