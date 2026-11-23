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

import { describe, expect, it, jest } from "@jest/globals";
import type {
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  Step,
  Transaction,
} from "../schema.js";
import {
  canComplete,
  concludeStep,
  conditionOf,
  findExpectedStates,
  go,
  handleEvents,
  ifCompleted,
  ifFailed,
  pass,
  reachableStates,
  stateMachine,
  stay,
  type LifecycleEvent,
  type Next,
  type StateMachineDef,
  type TransitionEntry,
  type WhenInput,
} from "./index.js";
import { BulkUpsertBuilder } from "../bulk-upsert-builder.js";
import { matchesKey, readTransaction } from "./machine.js";

const TYPE = "urn:kld:transactiontype=td-transfer";
const TX = `${TYPE}:transaction=tx1`;
const ctx = { config: {}, subledger: { bulkQuery: async () => ({}) } };

const T0 = "2026-10-13T00:00:00Z";
const assigned = { id: 1, created: T0, updated: T0 };
const record = (extra: Partial<Transaction> = {}): Transaction => ({
  ...assigned,
  urn: TX,
  name: "tx1",
  transactionTypeUrn: TYPE,
  status: "active",
  steps: [],
  ...extra,
});
const inState = (state: string, extra: Partial<Transaction> = {}) =>
  record({ labels: { state }, ...extra });
const event = (name: string, subject = TX): LifecycleEvent => ({
  ...assigned,
  urn: `${TX}:event=${name}`,
  name,
  eventType: name.split(".")[0] as LifecycleEvent["eventType"],
  transactionUrn: TX,
  subjectUrn: subject,
});
const step = (name: string, state: string, status: Step["status"] = "started"): Step => ({
  ...assigned,
  urn: `${TX}:step=${name}`,
  name,
  transactionUrn: TX,
  status,
  labels: { state },
});
const outcome = (name: string) => event(`step-outcome.${name}`, `${TX}:step=${name}`);

type Body = { body: BulkUpsertInput } | undefined;
const labelsOf = (result: Body) => result?.body.lifecycle?.transactions?.[0].items[0].labels;
const stepsOf = (result: Body) =>
  (result?.body.lifecycle?.steps ?? []).flatMap((s) => s.items.map((i) => i.name));
const outcomesOf = (result: Body) =>
  (result?.body.lifecycle?.transactionOutcomes ?? []).flatMap((s) => s.items);

describe("event keys", () => {
  it("match part by part, * standing for any whole part", () => {
    expect(matchesKey("step-outcome.mint", "step-outcome.mint")).toBe(true);
    expect(matchesKey("step-outcome.mint", "step-outcome.mint.1")).toBe(false);
    expect(matchesKey("condition-signaled.mint.*", "condition-signaled.mint.1")).toBe(true);
    expect(matchesKey("condition-signaled.mint.*", "condition-signaled.minted.1")).toBe(false);
    expect(matchesKey("condition-signaled.*.*", "condition-signaled.minted.1")).toBe(true);
    expect(matchesKey("step-outcome.*", "step-outcome.lock")).toBe(true);
    expect(matchesKey("step-outcome.*", "step-outcome.lock.2")).toBe(true);
    expect(matchesKey("step-outcome.*", "step-outcomes")).toBe(false);
    expect(matchesKey("step-outcome.mint", "step-outcomeXmint")).toBe(false);
  });

  it("read a member's name with its dots", () => {
    expect(matchesKey("step-outcome.kyc.check", "step-outcome.kyc.check")).toBe(true);
    expect(matchesKey("step-outcome.kyc", "step-outcome.kyc.check")).toBe(false);
    expect(matchesKey("condition-signaled.kyc.check.*", "condition-signaled.kyc.check.42")).toBe(
      true,
    );
    expect(matchesKey("condition-signaled.kyc.*", "condition-signaled.kyc.check.42")).toBe(false);
    expect(matchesKey("condition-signaled.*.42", "condition-signaled.kyc.check.42")).toBe(true);
  });

  it("refuse a key that can match no event", () => {
    const machine = (key: string) =>
      stateMachine({
        initial: go("a"),
        states: { a: { on: { [key]: go("a") } as never } },
      });
    for (const key of [
      "step-outcomes.*",
      "condition-signaled.mint",
      "step-outcome",
      "step-outcome.",
      "step-outcome.lock-*",
      "step-outcome.kyc.*",
    ]) {
      expect(() => machine(key)).toThrow(`Transition a on ${key}: invalid event key`);
    }
  });

  it("order the state's matches, then the machine's own, except in a final state", async () => {
    const tried: string[] = [];
    const entry = (key: string): TransitionEntry => ({
      run: () => {
        tried.push(key);
        return pass();
      },
      to: [],
    });
    const machine = stateMachine({
      initial: go("a"),
      states: {
        a: { on: { "step-outcome.*": entry("a *"), "step-outcome.x": entry("a x") } },
        b: {},
        done: { type: "final", outcome: "completed" },
        failed: { type: "final", outcome: "failed" },
      },
      on: { "step-outcome.*": entry("any *"), "transaction-outcome": entry("any end") },
    });
    const keys = async (state: string, name: string) => {
      tried.length = 0;
      await machine.evaluate(ctx, inState(state), event(name));
      return [...tried];
    };
    expect(await keys("a", "step-outcome.x")).toEqual(["a *", "a x", "any *"]);
    expect(await keys("b", "transaction-outcome")).toEqual(["any end"]);
    expect(await keys("failed", "transaction-outcome")).toEqual([]);
  });

  it("pass the event to the next match on pass(), discarding what the transition added", async () => {
    const machine = stateMachine({
      initial: go("a"),
      states: {
        a: {
          on: {
            "step-outcome.x": {
              run: ({ builder }) => {
                builder.lifecycle.add({
                  legs: [{ transactionTypeUrn: TYPE, items: [{ name: "discarded" } as never] }],
                });
                return pass();
              },
              to: [],
            },
          },
        },
        failed: { type: "final", outcome: "failed" },
      },
      on: { "step-outcome.*": { run: () => go("failed"), to: ["failed"] } },
    });
    const result = await machine.evaluate(ctx, inState("a"), event("step-outcome.x"));
    expect(result).toMatchObject({ to: "failed" });
    expect(result!.body.lifecycle?.legs).toBeUndefined();
  });
});

describe("ifCompleted and ifFailed", () => {
  const machine = stateMachine({
    initial: go("a"),
    states: {
      a: {
        on: {
          "step-outcome.x": ifCompleted({ run: () => go("done"), to: ["done"] }),
          "step-outcome.y": ifFailed(go("retrying")),
        },
      },
      done: { type: "final", outcome: "completed" },
      retrying: { type: "final", outcome: "failed" },
      failed: { type: "final", outcome: "failed" },
    },
    on: { "step-outcome.*": go("failed") },
  });
  const result = (name: string, status: Step["status"]) =>
    machine.evaluate(ctx, inState("a", { steps: [step(name, "a", status)] }), outcome(name));

  it("run an ifCompleted transition for a completed step", async () => {
    expect(await result("x", "completed")).toMatchObject({ to: "done" });
  });

  it("pass a failed step's outcome on from an ifCompleted transition", async () => {
    expect(await result("x", "failed")).toMatchObject({ to: "failed" });
  });

  it("run an ifFailed transition for a failed step", async () => {
    expect(await result("y", "failed")).toMatchObject({ to: "retrying" });
  });

  it("pass a completed step's outcome on from an ifFailed transition", async () => {
    expect(await result("y", "completed")).toMatchObject({ to: "failed" });
  });
});

describe("evaluate", () => {
  const machine = stateMachine({
    initial: go("received"),
    states: {
      received: {
        steps: ["check"],
        then: {
          run: ({ builder }, { transaction }) => {
            builder.lifecycle.add({
              transactions: [
                {
                  transactionTypeUrn: TYPE,
                  items: [{ name: transaction.name, labels: { amount: "10" } }],
                },
              ],
            });
            return go("accepted");
          },
          to: ["accepted"],
        },
        on: { "condition-signaled.hold.*": stay() },
      },
      accepted: {
        steps: [
          {
            name: "fund",
            when: ({ updatedTransaction }) => updatedTransaction.labels.amount === "10",
          },
          "move",
          "report",
        ],
        then: go("completed"),
      },
      completed: { type: "final", outcome: "completed" },
      failed: { type: "final", outcome: "failed" },
    },
    on: {
      "step-outcome.*": ifFailed({
        run: () => go("failed", { error: "E|boom" }),
        to: ["failed"],
      }),
    },
  });
  const planned = (state: string, plannedSteps: string, steps: Step[], previousStates = "") =>
    record({ labels: { state, plannedSteps, previousStates }, steps });

  it("ignores the transaction-accepted event of a transaction that has concluded", async () => {
    const concluded = record({ status: "completed" });
    expect(await machine.evaluate(ctx, concluded, event("transaction-accepted"))).toBeUndefined();
  });

  it("enters the initial state on a transaction's first evaluation, adding its first step", async () => {
    const result = await machine.evaluate(ctx, record(), event("transaction-accepted"));
    expect(result).toMatchObject({ from: undefined, to: "received" });
    expect(labelsOf(result)).toEqual({
      state: "received",
      previousStates: "",
      expectedStates: "accepted,completed",
      plannedSteps: "check",
    });
    expect(result!.body.lifecycle?.steps).toEqual([
      {
        transactionTypeUrn: TYPE,
        updateStrategy: "create_or_ignore",
        labelStrategy: "create_or_ignore",
        items: [{ name: "check", transactionUrn: TX, labels: { state: "received" } }],
      },
    ]);
    expect(result!.body.lifecycle?.stepStarts).toBeUndefined();
  });

  it("takes the initial transition on a transaction's first evaluation, with what it adds", async () => {
    const started = stateMachine({
      ...machine.def,
      initial: {
        run: ({ builder }, { transaction }) => {
          builder.lifecycle.add({
            legs: [{ transactionTypeUrn: TYPE, items: [{ name: transaction.name } as never] }],
          });
          return go("accepted");
        },
        to: ["received", "accepted"],
      },
    });
    const result = await started.evaluate(ctx, record(), event("transaction-accepted"));
    expect(result).toMatchObject({ from: undefined, to: "accepted" });
    expect(labelsOf(result)).toMatchObject({ state: "accepted", plannedSteps: "move,report" });
    expect(result!.body.lifecycle?.legs?.[0].items).toEqual([{ name: "tx1" }]);
    expect(stepsOf(result)).toEqual(["move"]);
  });

  it("refuses to add a step that another state already added", async () => {
    const twice = stateMachine({
      initial: go("a"),
      states: {
        a: { on: { "transaction-outcome": go("b") } },
        b: { steps: ["x"], then: go("done") },
        done: { type: "final", outcome: "completed" },
      },
    });
    const tx = { ...inState("a"), steps: [step("x", "z", "completed")] };
    await expect(twice.evaluate(ctx, tx, event("transaction-outcome"))).rejects.toThrow(
      "Step x was added in state z; it cannot be added again in b",
    );
  });

  it("runs a step given as an object with no when", async () => {
    const named = stateMachine({
      initial: go("a"),
      states: {
        a: { steps: [{ name: "x" }], then: go("done") },
        done: { type: "final", outcome: "completed" },
      },
    });
    const result = await named.evaluate(ctx, record(), event("transaction-accepted"));
    expect(labelsOf(result)).toMatchObject({ state: "a", plannedSteps: "x" });
  });

  it("asks a when with the legs the initial transition wrote", async () => {
    const funding = stateMachine({
      initial: {
        run: ({ builder }, { transaction }) => {
          builder.lifecycle.add({
            legs: [
              {
                transactionTypeUrn: TYPE,
                items: [{ name: "fund", transactionUrn: transaction.urn } as never],
              },
            ],
          });
          return go("accepted");
        },
        to: ["accepted"],
      },
      states: {
        accepted: {
          steps: [
            {
              name: "mint",
              when: ({ updatedTransaction }) => updatedTransaction.legs.includes("fund"),
            },
          ],
          then: go("done"),
        },
        done: { type: "final", outcome: "completed" },
      },
    });
    const result = await funding.evaluate(ctx, record(), event("transaction-accepted"));
    expect(labelsOf(result)).toMatchObject({ state: "accepted", plannedSteps: "mint" });
  });

  it("refuses an initial transition that does not go to one of its states", async () => {
    const stays = stateMachine({
      ...machine.def,
      initial: { run: () => stay() as never, to: ["received"] },
    });
    await expect(stays.evaluate(ctx, record(), event("transaction-accepted"))).rejects.toThrow(
      "The initial transition must go to one of received",
    );
    const strays = stateMachine({
      ...machine.def,
      initial: { run: () => go("accepted"), to: ["received"] },
    });
    await expect(strays.evaluate(ctx, record(), event("transaction-accepted"))).rejects.toThrow(
      "The initial transition must go to one of received",
    );
  });

  it("ignores every other event for a transaction with no state", async () => {
    expect(await machine.evaluate(ctx, record(), outcome("check"))).toBeUndefined();
  });

  it("ignores a transaction-accepted event once the transaction has a state", async () => {
    expect(
      await machine.evaluate(ctx, inState("received"), event("transaction-accepted")),
    ).toBeUndefined();
  });

  it("adds the next chosen step when one completes, without relabelling the transaction", async () => {
    const tx = planned("accepted", "fund,move,report", [step("fund", "accepted", "completed")]);
    const result = await machine.evaluate(ctx, tx, outcome("fund"));
    expect(result).toMatchObject({ from: "accepted", to: "accepted" });
    expect(stepsOf(result)).toEqual(["move"]);
    expect(result!.body.lifecycle?.transactions).toBeUndefined();
  });

  it("runs then after the last chosen step, appending the state it leaves to the states left before it", async () => {
    const tx = planned("received", "check", [step("check", "received", "completed")], "start");
    const result = await machine.evaluate(ctx, tx, outcome("check"));
    expect(labelsOf(result)).toEqual({
      amount: "10",
      state: "accepted",
      previousStates: "start,received",
      expectedStates: "completed",
      plannedSteps: "fund,move,report",
    });
    expect(result!.body.lifecycle?.steps?.[0].items).toEqual([
      { name: "fund", transactionUrn: TX, labels: { state: "accepted" } },
    ]);
  });

  it("asks each step's when once on entry, with the updated transaction, the state it left and the states left", async () => {
    const seen: WhenInput[] = [];
    const watched = stateMachine({
      ...machine.def,
      states: {
        ...machine.def.states,
        accepted: {
          steps: [
            {
              name: "fund",
              when: (input) => {
                seen.push(input);
                return false;
              },
            },
            "move",
          ],
          then: go("completed"),
        },
      },
    } as StateMachineDef);
    const tx = planned("received", "check", [step("check", "received", "completed")]);
    const result = await watched.evaluate(ctx, tx, outcome("check"));
    expect(seen).toEqual([
      {
        transaction: tx,
        updatedTransaction: { labels: { ...tx.labels, amount: "10" }, legs: [] },
        from: "received",
        previousStates: ["received"],
      },
    ]);
    expect(labelsOf(result)).toMatchObject({ plannedSteps: "move" });
    expect(stepsOf(result)).toEqual(["move"]);
  });

  it("passes through a state with no chosen step, running its then on entry and labelling once", async () => {
    const result = await machine.evaluate(
      ctx,
      planned("received", "check", [step("check", "received", "completed")]),
      outcome("check"),
    );
    expect(result).toMatchObject({ to: "accepted" });
    const skipping = stateMachine({
      ...machine.def,
      states: {
        ...machine.def.states,
        accepted: { steps: [{ name: "fund", when: () => false }], then: go("completed") },
      },
    } as StateMachineDef);
    const passed = await skipping.evaluate(
      ctx,
      planned("received", "check", [step("check", "received", "completed")]),
      outcome("check"),
    );
    expect(passed).toMatchObject({ from: "received", to: "completed" });
    expect(passed!.body.lifecycle?.transactions?.[0].items).toHaveLength(1);
    expect(labelsOf(passed)).toEqual({
      amount: "10",
      state: "completed",
      previousStates: "received,accepted",
      expectedStates: "",
      plannedSteps: "",
    });
    expect(outcomesOf(passed)).toMatchObject([{ status: "completed" }]);
  });

  it("refuses a run of states passed through that never stops", async () => {
    const looping = stateMachine({
      initial: go("a"),
      states: {
        a: { steps: [{ name: "x", when: () => false }], then: go("b") },
        b: { steps: [{ name: "y", when: () => false }], then: go("a") },
      },
    });
    await expect(looping.evaluate(ctx, record(), event("transaction-accepted"))).rejects.toThrow(
      "passed through more states than the machine has",
    );
  });

  it("advances only on the completed outcome of a step chosen in the current state", async () => {
    const tx = (s: Step, plannedSteps = "fund,move,report") =>
      planned("accepted", plannedSteps, [s]);
    expect(
      await machine.evaluate(ctx, tx(step("check", "received", "completed")), outcome("check")),
    ).toBeUndefined();
    expect(
      await machine.evaluate(
        ctx,
        tx(step("fund", "accepted", "completed"), "move,report"),
        outcome("fund"),
      ),
    ).toBeUndefined();
    expect(
      await machine.evaluate(ctx, tx(step("fund", "accepted", "failed")), outcome("fund")),
    ).toMatchObject({ to: "failed" });
  });

  it("runs a state's transition on its own step's completion before advancing, unless it moves", async () => {
    const reacting = (run: () => Next) =>
      stateMachine({
        initial: go("a"),
        states: {
          a: {
            steps: ["x", "y"],
            then: go("done"),
            on: { "step-outcome.x": { to: ["other"], run } },
          },
          done: { type: "final", outcome: "completed" },
          other: { type: "final", outcome: "failed" },
        },
      });
    const tx = planned("a", "x,y", [step("x", "a", "completed")]);
    expect(stepsOf(await reacting(() => stay()).evaluate(ctx, tx, outcome("x")))).toEqual(["y"]);
    const moved = await reacting(() => go("other")).evaluate(ctx, tx, outcome("x"));
    expect(moved).toMatchObject({ to: "other" });
    expect(stepsOf(moved)).toEqual([]);
  });

  it("writes each step as prepareStep returns it", async () => {
    const seen: unknown[] = [];
    const prepared = stateMachine({
      ...machine.def,
      options: {
        prepareStep: (step, input) => {
          seen.push(input);
          return { ...step, labels: { order: "1" } };
        },
      },
    });
    const tx = planned("accepted", "fund,move,report", [step("fund", "accepted", "completed")]);
    const result = await prepared.evaluate(ctx, tx, outcome("fund"));
    expect(seen).toEqual([
      { transaction: tx, state: "accepted", updatedTransaction: { labels: tx.labels, legs: [] } },
    ]);
    expect(result!.body.lifecycle?.steps?.[0].items[0].labels).toEqual({
      order: "1",
      state: "accepted",
    });
  });

  it("prepares a step when it is added, from earlier steps and reads, then applies prepareStep", async () => {
    const bulkQuery = jest.fn(
      async (): Promise<BulkQueryOutput> => ({ registry: { assets: { count: 3 } } }),
    );
    const prepared = stateMachine({
      initial: go("accepted"),
      states: {
        accepted: {
          steps: [
            "fund",
            {
              name: "move",
              prepare: async ({ subledger }, { transaction, event }) => {
                const res = await subledger.bulkQuery({});
                const fund = transaction.steps!.find((s) => s.urn === event.subjectUrn)!;
                return {
                  labels: { assets: String(res.registry?.assets?.count) },
                  info: { from: fund.outcome?.info },
                };
              },
            },
          ],
          then: go("done"),
        },
        done: { type: "final", outcome: "completed" },
      },
      options: { prepareStep: (step) => ({ ...step, labels: { ...step.labels, order: "2" } }) },
    });
    const fund = { ...step("fund", "accepted", "completed"), outcome: { info: { wallet: "0x1" } } };
    const tx = planned("accepted", "fund,move", [fund as Step]);
    const result = await prepared.evaluate(
      { config: {}, subledger: { bulkQuery } },
      tx,
      outcome("fund"),
    );
    expect(result!.body.lifecycle?.steps?.[0].items[0]).toEqual({
      name: "move",
      transactionUrn: TX,
      labels: { assets: "3", order: "2", state: "accepted" },
      info: { from: { wallet: "0x1" } },
    });
  });

  it("refuses a prepareStep that renames the step", async () => {
    const renamed = stateMachine({
      ...machine.def,
      options: { prepareStep: (step) => ({ ...step, name: "other" }) },
    });
    await expect(renamed.evaluate(ctx, record(), event("transaction-accepted"))).rejects.toThrow(
      "prepareStep renamed step check to other",
    );
  });

  it("concludes the transaction on entering a final state, failed with the move's error", async () => {
    const done = await machine.evaluate(
      ctx,
      planned("accepted", "move,report", [step("report", "accepted", "completed")], "received"),
      outcome("report"),
    );
    expect(labelsOf(done)).toEqual({
      state: "completed",
      previousStates: "received,accepted",
      expectedStates: "",
      plannedSteps: "",
    });
    expect(outcomesOf(done)).toEqual([
      { transactionUrn: TX, status: "completed", causationUrn: `${TX}:event=step-outcome.report` },
    ]);
    const failed = await machine.evaluate(
      ctx,
      planned("accepted", "move,report", [step("move", "accepted", "failed")]),
      outcome("move"),
    );
    expect(outcomesOf(failed)).toEqual([
      {
        transactionUrn: TX,
        status: "failed",
        causationUrn: `${TX}:event=step-outcome.move`,
        error: "E|boom",
      },
    ]);
  });

  it("concludes the transaction with the outcome the move gives", async () => {
    const caused = stateMachine({
      initial: go("a"),
      states: {
        a: {
          on: {
            "transaction-outcome": go("done", { causationUrn: "urn:x", info: { n: 1 } }),
          },
        },
        done: { type: "final", outcome: "completed" },
      },
    });
    const result = await caused.evaluate(ctx, inState("a"), event("transaction-outcome"));
    expect(outcomesOf(result)).toEqual([
      { transactionUrn: TX, status: "completed", causationUrn: "urn:x", info: { n: 1 } },
    ]);
  });

  it("gives the then of a state it passes through the labels written before it", async () => {
    const passing = stateMachine({
      initial: go("a"),
      states: {
        a: {
          on: {
            "transaction-outcome": {
              run: ({ builder }, { transaction }) => {
                builder.lifecycle.add({
                  transactions: [
                    {
                      transactionTypeUrn: TYPE,
                      items: [{ name: transaction.name, labels: { why: "E|why" } }],
                    },
                  ],
                });
                return go("b");
              },
              to: ["b"],
            },
          },
        },
        b: {
          steps: [{ name: "x", when: () => false }],
          then: {
            run: (_ctx, { updatedTransaction }) =>
              go("failed", { error: updatedTransaction.labels.why }),
            to: ["failed"],
          },
        },
        failed: { type: "final", outcome: "failed" },
      },
    });
    const result = await passing.evaluate(ctx, inState("a"), event("transaction-outcome"));
    expect(outcomesOf(result)).toEqual([
      {
        transactionUrn: TX,
        status: "failed",
        causationUrn: `${TX}:event=transaction-outcome`,
        error: "E|why",
      },
    ]);
  });

  it("refuses an outcome on a move to a state that is not final", async () => {
    const early = stateMachine({
      initial: go("a"),
      states: {
        a: { on: { "transaction-outcome": go("b", { error: "E|early" }) } },
        b: { on: { "transaction-outcome": go("done") } },
        done: { type: "final", outcome: "completed" },
      },
    });
    await expect(early.evaluate(ctx, inState("a"), event("transaction-outcome"))).rejects.toThrow(
      "The move to b gives an outcome, and b is not a final state",
    );
  });

  it("refuses a then that goes outside its to", async () => {
    const strays = stateMachine({
      initial: go("a"),
      states: {
        a: { steps: ["x"], then: { run: () => go("c"), to: ["b"] } },
        b: { type: "final", outcome: "completed" },
        c: { type: "final", outcome: "completed" },
      },
    });
    await expect(
      strays.evaluate(ctx, planned("a", "x", [step("x", "a", "completed")]), outcome("x")),
    ).rejects.toThrow("Transition a on then: went to c, which is not in its to: b");
  });

  it("writes nothing for an unmatched event, or a stay that added nothing", async () => {
    expect(
      await machine.evaluate(ctx, inState("received"), event("leg-added.main")),
    ).toBeUndefined();
    expect(
      await machine.evaluate(ctx, inState("received"), event("condition-signaled.hold.1")),
    ).toBeUndefined();
  });

  it("does nothing for a transaction in a state the machine does not define", async () => {
    expect(await machine.evaluate(ctx, inState("ready"), outcome("check"))).toBeUndefined();
  });

  it("uses the machine's expected states when it gives them", async () => {
    const custom = stateMachine({
      ...machine.def,
      options: { expectedStates: ({ state }) => [`after-${state}`] },
    } as StateMachineDef);
    const result = await custom.evaluate(ctx, record(), event("transaction-accepted"));
    expect(labelsOf(result)).toMatchObject({ state: "received", expectedStates: "after-received" });
  });

  it("handles every transaction's creation, its declared steps' outcomes, and the events its transitions match", () => {
    expect(machine.handles(event("transaction-accepted"))).toBe(true);
    expect(machine.handles(outcome("report"))).toBe(true);
    expect(machine.handles(event("condition-signaled.hold.1"))).toBe(true);
    expect(machine.handles(event("step-added.report"))).toBe(false);
  });
});

describe("concludeStep", () => {
  it("writes the step's outcome, caused by the event unless the outcome names its cause", () => {
    const builder = new BulkUpsertBuilder(
      { bulkUpsert: async () => ({}) },
      { defaults: { updateStrategy: "create_or_ignore" } },
    );
    const input = { transaction: inState("a"), state: "a", event: event("condition-signaled.x.1") };
    const tctx = { ...ctx, builder, def: { initial: go("a"), states: { a: {} } } };
    concludeStep(tctx, input, "x", { status: "completed", info: { hash: "0x1" } });
    concludeStep(tctx, input, "y", { status: "failed", error: "E|bad", causationUrn: "urn:c" });
    expect(builder.toBulkUpsert().lifecycle?.stepOutcomes?.flatMap((o) => o.items)).toEqual([
      {
        causationUrn: `${TX}:event=condition-signaled.x.1`,
        status: "completed",
        info: { hash: "0x1" },
        stepUrn: `${TX}:step=x`,
      },
      { causationUrn: "urn:c", status: "failed", error: "E|bad", stepUrn: `${TX}:step=y` },
    ]);
  });
});

describe("definitions", () => {
  it("refuse a target the machine does not define or list as final", () => {
    expect(() =>
      stateMachine({
        initial: go("a"),
        states: {
          a: { on: { "transaction-outcome": { run: () => go("done"), to: ["done", "nowhere"] } } },
          done: { type: "final", outcome: "completed" },
        },
      }),
    ).toThrow("Transition a on transaction-outcome: goes to unknown state nowhere");
  });

  it("refuse an initial transition to an unknown state or to none", () => {
    expect(() => stateMachine({ initial: go("a"), states: { b: {} } })).toThrow(
      "The initial transition goes to unknown state a",
    );
    expect(() =>
      stateMachine({ initial: { run: () => go("b"), to: [] }, states: { b: {} } }),
    ).toThrow("The initial transition goes to no state");
  });

  it("refuse a final state that declares steps or transitions", () => {
    expect(() =>
      stateMachine({
        initial: go("a"),
        states: { a: {}, z: { type: "final", outcome: "failed", on: {} } as never },
      }),
    ).toThrow("Final state z declares steps or transitions");
  });

  it("refuse a transition on transaction-accepted, which the initial transition takes", () => {
    expect(() =>
      stateMachine({
        initial: go("a"),
        states: { a: { on: { "transaction-accepted": stay() } as never } },
      }),
    ).toThrow("Transition a on transaction-accepted: invalid event key");
  });

  it("refuse steps without a then, a then without steps, and a step declared twice", () => {
    const machine = (a: object) => () =>
      stateMachine({
        initial: go("a"),
        states: { a, done: { type: "final", outcome: "completed" } },
      });
    expect(machine({ steps: ["x"] })).toThrow("State a has steps and no then");
    expect(machine({ then: go("done") })).toThrow("State a has a then and no steps");
    expect(machine({ steps: ["x", { name: "x", when: () => true }], then: go("done") })).toThrow(
      "State a declares a step twice",
    );
  });

  it("type a transition without to as one that cannot move the transaction", () => {
    const staying: TransitionEntry = { run: () => stay() };
    // @ts-expect-error a transition without `to` cannot go
    const moving: TransitionEntry = { run: () => go("b") };
    expect([staying, moving]).toHaveLength(2);
  });

  it("refuse a then to a state the machine does not define", () => {
    expect(() =>
      stateMachine({ initial: go("a"), states: { a: { steps: ["x"], then: go("nowhere") } } }),
    ).toThrow("Transition a on then: goes to unknown state nowhere");
  });

  it("refuse a go to a state the entry does not declare", async () => {
    const machine = stateMachine({
      initial: go("a"),
      states: {
        a: { on: { "transaction-outcome": { run: () => go("c"), to: ["b"] } } },
        b: { type: "final", outcome: "completed" },
        c: { type: "final", outcome: "completed" },
      },
    });
    await expect(machine.evaluate(ctx, inState("a"), event("transaction-outcome"))).rejects.toThrow(
      "went to c, which is not in its to: b",
    );
  });

  it("draw one arrow per source and target, then among them, and the machine's own transitions from one node", () => {
    const machine = stateMachine({
      initial: go("start"),
      states: {
        start: { on: { "transaction-outcome": { run: () => go("settling"), to: ["settling"] } } },
        settling: {
          steps: ["settle"],
          then: go("done"),
          on: {
            "condition-signaled.settle.*": { run: () => stay() },
            "condition-signaled.cancelled.*": { run: () => go("done"), to: ["done"] },
          },
        },
        done: { type: "final", outcome: "completed" },
        failed: { type: "final", outcome: "failed" },
      },
      on: { "step-outcome.*": { run: () => pass(), to: ["failed"] } },
    });
    expect(machine.mermaid().split("\n")).toEqual([
      "stateDiagram-v2",
      '    state "any state" as anyState',
      "    [*] --> start",
      "    start --> settling: transaction-outcome",
      "    settling --> done: then<br/>condition-signaled.cancelled.*",
      "    anyState --> failed: step-outcome.*",
      "    done --> [*]",
      "    failed --> [*]",
      "    settling: settle",
    ]);
  });
});

describe("expected states", () => {
  const def: StateMachineDef = {
    initial: go("proposed"),
    states: {
      proposed: { on: { "condition-signaled.agreed.*": go("agreed") } },
      agreed: {
        on: {
          "condition-signaled.settled.*": go("settled"),
          "condition-signaled.cancel.*": go("recalled"),
        },
      },
      recalled: {
        on: {
          "condition-signaled.settled.*": go("settled"),
          "condition-signaled.cancelled.*": go("refused"),
        },
      },
      settled: { on: { "transaction-outcome": go("completed") } },
      refused: { on: { "transaction-outcome": go("rejected") } },
      completed: { type: "final", outcome: "completed" },
      rejected: { type: "final", outcome: "failed" },
      unresolved: { type: "final", outcome: "failed" },
    },
    on: { "step-outcome.*": go("unresolved") },
  };

  it("list the reachable states that can complete, from a state that can", () => {
    expect(findExpectedStates(def, "proposed")).toEqual([
      "agreed",
      "recalled",
      "settled",
      "completed",
    ]);
    expect(findExpectedStates(def, "proposed", { ignore: ["recalled"] })).toEqual([
      "agreed",
      "settled",
      "completed",
    ]);
  });

  it("list the reachable states that cannot complete, from a state that cannot", () => {
    expect(findExpectedStates(def, "recalled", { ignore: ["recalled"] })).toEqual([
      "refused",
      "rejected",
      "unresolved",
    ]);
    expect(findExpectedStates(def, "refused")).toEqual(["rejected", "unresolved"]);
    expect(findExpectedStates(def, "completed")).toEqual([]);
  });

  it("follow a state's then", () => {
    const working: StateMachineDef = {
      ...def,
      states: { ...def.states, agreed: { steps: ["commit"], then: go("settled") } },
    };
    expect(findExpectedStates(working, "agreed")).toEqual(["settled", "completed"]);
  });

  it("expose the reachable states and whether a state can complete", () => {
    expect([...reachableStates(def, "settled")].sort()).toEqual(["completed", "unresolved"]);
    expect(canComplete(def, "recalled")).toBe(true);
    expect(canComplete(def, "recalled", { ignore: ["recalled"] })).toBe(false);
    expect(canComplete(def, "agreed", { ignore: ["recalled"] })).toBe(true);
  });
});

describe("conditionOf", () => {
  it("find the condition a condition-signaled event names by its subject", () => {
    const condition = {
      ...assigned,
      urn: `${TX}:condition=c`,
      name: "c",
      transactionUrn: TX,
      waitKey: "w1",
    };
    const input = {
      transaction: record({ conditions: [condition] }),
      state: "a",
      event: event("condition-signaled.c.7", condition.urn),
    };
    expect(conditionOf(input)).toMatchObject({ name: "c", waitKey: "w1" });
  });
});

describe("handleEvents", () => {
  const machine = stateMachine({
    initial: go("start"),
    states: {
      start: { on: { "transaction-outcome": go("done") } },
      done: { type: "final", outcome: "completed" },
    },
  });
  const read = (...txs: Transaction[]): BulkQueryOutput => ({
    lifecycle: { transactions: [{ items: txs }] },
  });
  const client = (out: BulkQueryOutput) => ({
    bulkQuery: jest.fn(async (_: BulkQueryInput): Promise<BulkQueryOutput> => out),
    bulkUpsert: jest.fn(async (_: BulkUpsertInput) => ({})),
  });
  const handle = (c: ReturnType<typeof client>, events: LifecycleEvent[]) =>
    handleEvents({ config: {}, subledger: c }, [machine], events);
  const written = (c: ReturnType<typeof client>) =>
    c.bulkUpsert.mock.calls[0][0].lifecycle?.transactions?.[0].items;

  it("reads each event's transaction, and writes each event's body", async () => {
    const c = client(read(record()));
    await handle(c, [event("transaction-accepted")]);
    expect(c.bulkQuery).toHaveBeenCalledTimes(1);
    expect(c.bulkQuery.mock.calls[0][0]).toMatchObject({
      lifecycle: {
        transactions: [{ transactionTypeUrn: TYPE, equal: [{ field: "urn", value: TX }] }],
      },
      options: { includeChildren: true },
    });
    expect(written(c)).toEqual([
      {
        name: "tx1",
        labels: { state: "start", previousStates: "", expectedStates: "done", plannedSteps: "" },
      },
    ]);
  });

  it("reads the transaction again for each event", async () => {
    const c = client(read(record()));
    await handle(c, [event("transaction-accepted"), event("transaction-accepted")]);
    expect(c.bulkQuery).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed write", async () => {
    const c = client(read(record()));
    c.bulkUpsert.mockRejectedValueOnce(new Error("503 unavailable"));
    await expect(handle(c, [event("transaction-accepted")])).rejects.toThrow("503");
  });

  it("skips an event no machine handles, without a read", async () => {
    const c = client(read(record()));
    await handle(c, [event("step-added.x")]);
    expect(c.bulkQuery).not.toHaveBeenCalled();
  });

  it("evaluates with the first machine whose transaction filter accepts the transaction", async () => {
    const byRole = (role: string, initialState: string) =>
      stateMachine({
        initial: go(initialState),
        transactionFilter: (tx) => tx.labels?.role === role,
        states: { [initialState]: {} },
      });
    const machines = [byRole("a", "a-start"), byRole("b", "b-start")];
    const c = client(read(record({ labels: { role: "b" } })));
    await handleEvents({ config: {}, subledger: c }, machines, [event("transaction-accepted")]);
    expect(written(c)).toEqual([
      {
        name: "tx1",
        labels: { state: "b-start", previousStates: "", expectedStates: "", plannedSteps: "" },
      },
    ]);
  });

  it("skips an event whose transaction no machine's filter accepts", async () => {
    const only = stateMachine({ ...machine.def, transactionFilter: () => false });
    const c = client(read(record()));
    await handleEvents({ config: {}, subledger: c }, [only], [event("transaction-accepted")]);
    expect(c.bulkUpsert).not.toHaveBeenCalled();
  });

  it("skips an event whose transaction it cannot read", async () => {
    const c = client(read());
    await handle(c, [event("transaction-accepted")]);
    expect(c.bulkUpsert).not.toHaveBeenCalled();
  });

  it("reads one event's transaction with readTransaction", async () => {
    const c = client(read(record()));
    expect(await readTransaction(c, event("transaction-accepted"))).toMatchObject({ urn: TX });
    expect(c.bulkQuery.mock.calls[0][0].lifecycle?.signals).toBeUndefined();
  });
});
