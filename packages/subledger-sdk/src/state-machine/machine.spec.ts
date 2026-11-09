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
  stateMachine,
  go,
  pass,
  stay,
  stepUrn,
  addSteps,
  concludeStep,
  concludeTransaction,
  conditionOf,
  handleEvents,
  ifCompleted,
  ifFailed,
  startNextStep,
  startStep,
  type LifecycleEvent,
  type TransitionContext,
  type TransitionEntry,
  type TransitionFn,
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
const event = (name: string, subject = TX): LifecycleEvent => ({
  ...assigned,
  urn: `${TX}:event=${name}`,
  name,
  eventType: name.split(".")[0] as LifecycleEvent["eventType"],
  transactionUrn: TX,
  subjectUrn: subject,
});

const startSettle: TransitionFn = ({ builder }, { transaction, event }) => {
  builder.lifecycle.add({
    stepStarts: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ stepUrn: stepUrn(transaction, "settle"), causationUrn: event.urn }],
      },
    ],
  });
  return go("settling");
};

const label = (state: string) => ({
  transactionTypeUrn: TYPE,
  updateStrategy: "create_or_ignore",
  labelStrategy: "create_or_update",
  items: [{ name: "tx1", labels: { state } }],
});

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
      stateMachine({ initial: "a", final: [], states: { a: { on: { [key]: go("a") } as never } } });
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
      to: [],
      run: () => {
        tried.push(key);
        return pass();
      },
    });
    const machine = stateMachine({
      initial: "a",
      final: ["done", "failed"],
      states: {
        a: { on: { "step-outcome.*": entry("a *"), "step-outcome.x": entry("a x") } },
        b: {},
      },
      on: { "step-outcome.*": entry("any *"), "transaction-outcome": entry("any end") },
    });
    const keys = async (state: string, name: string) => {
      tried.length = 0;
      await machine.evaluate(ctx, record({ labels: { state } }), event(name));
      return [...tried];
    };
    expect(await keys("a", "step-outcome.x")).toEqual(["a *", "a x", "any *"]);
    expect(await keys("b", "transaction-outcome")).toEqual(["any end"]);
    expect(await keys("failed", "transaction-outcome")).toEqual([]);
    expect(machine.handles(event("step-added.x"))).toBe(false);
  });

  it("pass the event to the next match on pass(), discarding what the transition added", async () => {
    const machine = stateMachine({
      initial: "a",
      final: ["done", "failed"],
      states: {
        a: {
          on: {
            "step-outcome.x": {
              to: [],
              run: ({ builder }) => {
                builder.lifecycle.add({
                  stepStarts: [
                    { transactionTypeUrn: TYPE, items: [{ stepUrn: `${TX}:step=discarded` }] },
                  ],
                });
                return pass();
              },
            },
          },
        },
      },
      on: { "step-outcome.*": { to: ["failed"], run: () => go("failed") } },
    });
    const result = await machine.evaluate(ctx, record(), event("step-outcome.x"));
    expect(result).toMatchObject({ to: "failed" });
    expect(result!.body.lifecycle?.stepStarts).toBeUndefined();
  });
});

describe("ifCompleted and ifFailed", () => {
  const machine = stateMachine({
    initial: "a",
    final: ["done", "retrying", "failed"],
    states: {
      a: {
        on: {
          "step-outcome.x": ifCompleted({ to: ["done"], run: () => go("done") }),
          "step-outcome.y": ifFailed(go("retrying")),
        },
      },
    },
    on: { "step-outcome.*": go("failed") },
  });
  const outcome = (name: string, status: Step["status"]) =>
    machine.evaluate(
      ctx,
      record({
        steps: [{ ...assigned, urn: `${TX}:step=${name}`, name, transactionUrn: TX, status }],
      }),
      event(`step-outcome.${name}`, `${TX}:step=${name}`),
    );

  it("run an ifCompleted transition for a completed step", async () => {
    expect(await outcome("x", "completed")).toMatchObject({
      to: "done",
    });
  });

  it("pass a failed step's outcome on from an ifCompleted transition", async () => {
    expect(await outcome("x", "failed")).toMatchObject({
      to: "failed",
    });
  });

  it("run an ifFailed transition for a failed step", async () => {
    expect(await outcome("y", "failed")).toMatchObject({
      to: "retrying",
    });
  });

  it("pass a completed step's outcome on from an ifFailed transition", async () => {
    expect(await outcome("y", "completed")).toMatchObject({
      to: "failed",
    });
  });
});

describe("evaluate", () => {
  const machine = stateMachine({
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: {
        on: {
          "transaction-accepted": { to: ["settling"], run: startSettle },
          "step-added.*": { to: [], run: () => stay() },
        },
      },
      settling: {},
    },
  });

  it("reads the state from the label, else the initial state", async () => {
    const accepted = event("transaction-accepted");
    const flip = stateMachine({
      initial: "a",
      final: [],
      states: {
        a: { on: { "transaction-accepted": go("b") } },
        b: { on: { "transaction-accepted": go("a") } },
      },
    });
    expect(await flip.evaluate(ctx, record(), accepted)).toMatchObject({ from: "a" });
    expect(await flip.evaluate(ctx, record({ labels: { state: "b" } }), accepted)).toMatchObject({
      from: "b",
    });
  });

  it("writes the transition's rows and the state label in one body, rows create_or_ignore and labels create_or_update", async () => {
    const result = await machine.evaluate(ctx, record(), event("transaction-accepted"));
    expect(result).toMatchObject({
      from: "start",
      to: "settling",
    });
    expect(result!.body).toEqual({
      lifecycle: {
        stepStarts: [
          {
            transactionTypeUrn: TYPE,
            updateStrategy: "create_or_ignore",
            labelStrategy: "create_or_update",
            items: [
              { stepUrn: `${TX}:step=settle`, causationUrn: `${TX}:event=transaction-accepted` },
            ],
          },
        ],
        transactions: [label("settling")],
      },
    });
  });

  it("writes nothing for an unmatched event, or a stay that added nothing", async () => {
    expect(await machine.evaluate(ctx, record(), event("leg-added.main"))).toBeUndefined();
    expect(await machine.evaluate(ctx, record(), event("step-added.settle"))).toBeUndefined();
  });
});

describe("declared targets", () => {
  const machine = stateMachine({
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: { on: { "transaction-accepted": { to: ["settling"], run: () => go("elsewhere") } } },
      settling: {
        steps: ["settle"],
        on: {
          "transaction-outcome": go("done"),
          "condition-signaled.settle.*": { to: ["done"], run: () => go("done") },
        },
      },
    },
    on: { "step-outcome.*": { to: ["failed"], run: () => pass() } },
  });

  it("refuse a target the machine does not define or list as final", () => {
    expect(() =>
      stateMachine({
        initial: "a",
        final: ["done"],
        states: {
          a: { on: { "step-outcome.x": { to: ["done", "nowhere"], run: () => go("done") } } },
        },
      }),
    ).toThrow("Transition a on step-outcome.x: goes to unknown state nowhere");
  });

  it("refuse an initial state not in states, and a final state in states", () => {
    expect(() => stateMachine({ initial: "a", final: [], states: { b: {} } })).toThrow(
      "Initial state a is not in states",
    );
    expect(() => stateMachine({ initial: "a", final: ["a"], states: { a: {} } })).toThrow(
      "Final state a is also in states",
    );
  });

  it("refuse a go to a state the entry does not declare", async () => {
    await expect(machine.evaluate(ctx, record(), event("transaction-accepted"))).rejects.toThrow(
      "went to elsewhere, which is not in its to: settling",
    );
  });

  it("draw one arrow per source and target, and the machine's own transitions from one node", () => {
    expect(machine.mermaid().split("\n")).toEqual([
      "stateDiagram-v2",
      '    state "any state" as anyState',
      "    [*] --> start",
      "    start --> settling: transaction-accepted",
      "    settling --> done: transaction-outcome<br/>condition-signaled.settle.*",
      "    anyState --> failed: step-outcome.*",
      "    done --> [*]",
      "    failed --> [*]",
      "    settling: settle",
    ]);
  });
});

describe("steps", () => {
  const step = (name: string, state: string, status: Step["status"] = "pending"): Step => ({
    ...assigned,
    urn: `${TX}:step=${name}`,
    name,
    transactionUrn: TX,
    status,
    labels: { state },
  });
  const outcome = (name: string) => event(`step-outcome.${name}`, `${TX}:step=${name}`);
  const starts = (result?: { body: { lifecycle?: { stepStarts?: { items: unknown[] }[] } } }) =>
    (result?.body.lifecycle?.stepStarts ?? []).flatMap((s) =>
      s.items.map((i) => (i as { stepUrn: string }).stepUrn),
    );
  const machine = stateMachine({
    initial: "received",
    final: ["completed", "failed"],
    options: { autoStartSteps: true },
    states: {
      received: {
        steps: ["reserve"],
        on: {
          "step-started.reserve": {
            to: ["accepted"],
            run: (ctx, { transaction }) => {
              addSteps(
                ctx,
                transaction,
                ["report", "move"].map((name) => ({ name, state: "accepted" })),
              );
              return go("accepted");
            },
          },
        },
      },
      accepted: {
        steps: ["report", "fund", "move"],
        on: {
          "condition-signaled.move.*": go("settled"),
        },
      },
      settled: {
        steps: ["move", "notify"],
        on: {
          "step-outcome.notify": ifCompleted(go("completed")),
        },
      },
    },
    on: {
      "step-outcome.*": ifFailed(go("failed")),
    },
  });

  it("start the first of the steps a transition added for the state it goes to", async () => {
    const entered = await machine.evaluate(
      ctx,
      record({ steps: [step("reserve", "received", "started")] }),
      event("step-started.reserve"),
    );
    expect(entered).toMatchObject({ to: "accepted" });
    expect(starts(entered)).toEqual([`${TX}:step=report`]);
  });

  it("keep the record's status for a step a transition adds again", async () => {
    const entered = await machine.evaluate(
      ctx,
      record({
        steps: [step("reserve", "received", "started"), step("report", "accepted", "completed")],
      }),
      event("step-started.reserve"),
    );
    expect(starts(entered)).toEqual([`${TX}:step=move`]);
  });

  it("start the state's next pending step when a step completes, with no transition, skipping steps not added", async () => {
    const tx = record({
      labels: { state: "accepted" },
      steps: [step("report", "accepted", "completed"), step("move", "accepted")],
    });
    const result = await machine.evaluate(ctx, tx, outcome("report"));
    expect(result).toMatchObject({ to: "accepted" });
    expect(starts(result)).toEqual([`${TX}:step=move`]);
  });

  it("start nothing after one of the state's steps failed", async () => {
    const custom = stateMachine({
      initial: "a",
      final: [],
      options: { autoStartSteps: true },
      states: { a: { steps: ["x", "y"] } },
    });
    const tx = record({
      labels: { state: "a" },
      steps: [step("x", "a", "failed"), step("y", "a")],
    });
    expect(await custom.evaluate(ctx, tx, outcome("x"))).toBeUndefined();
    const signaled = event("condition-signaled.c.1", `${TX}:condition=c`);
    expect(await custom.evaluate(ctx, tx, signaled)).toBeUndefined();
  });

  it("start a state's pending step on any event while none runs or has failed", async () => {
    const tx = record({
      labels: { state: "settled" },
      steps: [step("move", "accepted", "completed"), step("notify", "settled")],
    });
    const result = await machine.evaluate(ctx, tx, outcome("move"));
    expect(result).toMatchObject({ to: "settled" });
    expect(starts(result)).toEqual([`${TX}:step=notify`]);
  });

  it("start nothing while a step of the state runs", async () => {
    const tx = record({
      labels: { state: "accepted" },
      steps: [step("report", "accepted", "completed"), step("move", "accepted", "started")],
    });
    expect(await machine.evaluate(ctx, tx, outcome("report"))).toBeUndefined();
  });

  it("start the first pending step of a state a transition goes to, by state label", async () => {
    const tx = record({
      labels: { state: "accepted" },
      steps: [step("move", "accepted", "completed"), step("notify", "settled")],
    });
    const signaled = event("condition-signaled.move.7", `${TX}:condition=move`);
    const result = await machine.evaluate(ctx, tx, signaled);
    expect(result).toMatchObject({ to: "settled" });
    expect(starts(result)).toEqual([`${TX}:step=notify`]);
  });

  it("start nothing once the last step completes", async () => {
    const tx = record({
      labels: { state: "settled" },
      steps: [step("move", "accepted", "completed"), step("notify", "settled", "completed")],
    });
    const result = await machine.evaluate(ctx, tx, outcome("notify"));
    expect(result).toMatchObject({ from: "settled", to: "completed" });
    expect(starts(result)).toEqual([]);
  });

  it("start nothing more when the transition started one of the steps it added", async () => {
    const custom = stateMachine({
      initial: "received",
      final: [],
      options: { autoStartSteps: true },
      states: {
        received: {
          on: {
            "step-started.reserve": {
              to: ["accepted"],
              run: (ctx, { transaction, event }) => {
                addSteps(ctx, transaction, [
                  { name: "report", state: "accepted" },
                  { name: "move", state: "accepted" },
                ]);
                startStep(ctx, transaction, "move", { causationUrn: event.urn });
                return go("accepted");
              },
            },
          },
        },
        accepted: { steps: ["report", "move"] },
      },
    });
    const result = await custom.evaluate(
      ctx,
      record({ steps: [step("reserve", "received", "started")] }),
      event("step-started.reserve"),
    );
    expect(starts(result)).toEqual([`${TX}:step=move`]);
  });

  it("leave a failed step's outcome to the * state", async () => {
    const tx = record({
      labels: { state: "settled" },
      steps: [step("notify", "settled", "failed")],
    });
    const result = await machine.evaluate(ctx, tx, outcome("notify"));
    expect(result).toMatchObject({ to: "failed" });
  });

  it("start a step the transition adds to the state it stays in", async () => {
    const custom = stateMachine({
      initial: "a",
      final: [],
      options: { autoStartSteps: true },
      states: {
        a: {
          steps: ["x"],
          on: {
            "transaction-accepted": {
              to: [],
              run: (ctx, { transaction }) => {
                addSteps(ctx, transaction, [{ name: "x", state: "a" }]);
                return stay();
              },
            },
          },
        },
      },
    });
    const result = await custom.evaluate(
      ctx,
      record({ labels: { state: "a" } }),
      event("transaction-accepted"),
    );
    expect(result).toMatchObject({ from: "a", to: "a" });
    expect(starts(result)).toEqual([`${TX}:step=x`]);
  });

  it("count only the transaction's own steps in the body", async () => {
    const TX2 = `${TYPE}:transaction=tx2`;
    const custom = stateMachine({
      initial: "start",
      final: [],
      options: { autoStartSteps: true },
      states: {
        start: {
          on: {
            "transaction-accepted": {
              to: ["a"],
              run: ({ builder }) => {
                builder.lifecycle.add({
                  steps: [
                    {
                      transactionTypeUrn: TYPE,
                      items: [{ name: "y", transactionUrn: TX2, labels: { state: "a" } }],
                    },
                  ],
                });
                return go("a");
              },
            },
          },
        },
        a: { steps: ["y"] },
      },
    });
    const result = await custom.evaluate(ctx, record(), event("transaction-accepted"));
    expect(result).toMatchObject({ to: "a" });
    expect(starts(result)).toEqual([]);
  });

  it("start nothing without autoStartSteps", async () => {
    const manual = stateMachine({ ...machine.def, options: undefined });
    const entered = await manual.evaluate(
      ctx,
      record({ steps: [step("reserve", "received", "started")] }),
      event("step-started.reserve"),
    );
    expect(entered).toMatchObject({ to: "accepted" });
    expect(starts(entered)).toEqual([]);
  });

  it("start the next step when a transition calls startNextStep", async () => {
    const manual = stateMachine({
      initial: "received",
      final: [],
      states: {
        received: {
          on: {
            "step-started.reserve": {
              to: ["accepted"],
              run: (ctx, input) => {
                addSteps(ctx, input.transaction, [
                  { name: "report", state: "accepted" },
                  { name: "move", state: "accepted" },
                ]);
                expect(startNextStep(ctx, input, "accepted")).toBe("report");
                return go("accepted");
              },
            },
          },
        },
        accepted: { steps: ["report", "move"] },
      },
    });
    const result = await manual.evaluate(
      ctx,
      record({ steps: [step("reserve", "received", "started")] }),
      event("step-started.reserve"),
    );
    expect(starts(result)).toEqual([`${TX}:step=report`]);
  });

  it("handle the outcomes of listed steps only with autoStartSteps", () => {
    const def = { initial: "a", final: [], states: { a: { steps: ["x", "kyc.check"] } } };
    const auto = stateMachine({ ...def, options: { autoStartSteps: true } });
    expect(auto.handles(outcome("x"))).toBe(true);
    expect(auto.handles(outcome("kyc.check"))).toBe(true);
    expect(auto.handles(outcome("kyc"))).toBe(false);
    expect(auto.handles(outcome("y"))).toBe(false);
    expect(stateMachine(def).handles(outcome("x"))).toBe(false);
  });
});

describe("record writers", () => {
  const machine = stateMachine({ initial: "a", final: [], states: { a: {} } });
  const writes = (write: (ctx: TransitionContext) => void) => {
    const builder = new BulkUpsertBuilder(
      { bulkUpsert: async () => ({}) },
      { defaults: { updateStrategy: "create_or_ignore", labelStrategy: "create_or_update" } },
    );
    write({ config: {}, subledger: ctx.subledger, builder, def: machine.def });
    return builder.toBulkUpsert().lifecycle;
  };

  it("add steps pending, each labelled with its state", () => {
    const l = writes((c) =>
      addSteps(c, record(), [
        { name: "s1", state: "a", labels: { leg: "fund" }, info: { venue: "x" } },
      ]),
    );
    expect(l?.steps?.[0].labelStrategy).toBe("create_or_ignore");
    expect(l?.steps?.[0].items).toEqual([
      { name: "s1", transactionUrn: TX, labels: { leg: "fund", state: "a" }, info: { venue: "x" } },
    ]);
  });

  it("start and conclude a step, and conclude the transaction", () => {
    const l = writes((c) => {
      startStep(c, record(), "s1", { causationUrn: "urn:e", labels: { attempt: "2" } });
      concludeStep(c, record(), "s1", {
        causationUrn: "urn:e",
        status: "failed",
        error: "E|boom",
        info: { code: 503 },
      });
      concludeTransaction(c, record(), {
        causationUrn: "urn:e",
        status: "completed",
        labels: { result: "settled" },
      });
    });
    expect(l?.stepStarts?.[0].items).toEqual([
      { stepUrn: `${TX}:step=s1`, causationUrn: "urn:e", labels: { attempt: "2" } },
    ]);
    expect(l?.stepOutcomes?.[0].items).toEqual([
      {
        stepUrn: `${TX}:step=s1`,
        causationUrn: "urn:e",
        status: "failed",
        error: "E|boom",
        info: { code: 503 },
      },
    ]);
    expect(l?.transactionOutcomes?.[0].items).toEqual([
      {
        transactionUrn: TX,
        causationUrn: "urn:e",
        status: "completed",
        labels: { result: "settled" },
      },
    ]);
  });

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
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: { on: { "transaction-accepted": { to: ["settling"], run: startSettle } } },
      settling: {},
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
    expect(c.bulkUpsert.mock.calls[0][0].lifecycle?.transactions).toEqual([label("settling")]);
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
    const byRole = (role: string, to: string) =>
      stateMachine({
        initial: "start",
        final: [to],
        transactionFilter: (tx) => tx.labels?.role === role,
        states: { start: { on: { "transaction-accepted": go(to) } } },
      });
    const machines = [byRole("a", "a-done"), byRole("b", "b-done")];
    const c = client(read(record({ labels: { role: "b" } })));
    await handleEvents({ config: {}, subledger: c }, machines, [event("transaction-accepted")]);
    expect(c.bulkUpsert.mock.calls[0][0].lifecycle?.transactions?.[0].items).toEqual([
      { name: "tx1", labels: { state: "b-done" } },
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
