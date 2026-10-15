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
import type { EventProcessorContext } from "@kaleido-io/workflow-engine-sdk";
import type { BulkQueryOutput, Transaction } from "../schema.js";
import { SubledgerClient } from "../subledger.js";
import {
  stateMachine,
  go,
  pass,
  stay,
  stepRef,
  type LifecycleEvent,
  type TransitionEntry,
  type TransitionFn,
} from "./index.js";
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
        items: [{ stepUrn: stepRef(transaction, "settle"), causationUrn: event.urn }],
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
  it("match as a glob: * matches any run of characters, everything else literally", () => {
    expect(matchesKey("step-outcome.mint", "step-outcome.mint")).toBe(true);
    expect(matchesKey("step-outcome.mint", "step-outcome.mint.1")).toBe(false);
    expect(matchesKey("condition-signaled.mint.*", "condition-signaled.mint.1")).toBe(true);
    expect(matchesKey("condition-signaled.mint.*", "condition-signaled.minted.1")).toBe(false);
    expect(matchesKey("step-outcome.*", "step-outcome.lock.2")).toBe(true);
    expect(matchesKey("step-outcome.*", "step-outcomes")).toBe(false);
    expect(matchesKey("*", "transaction-outcome")).toBe(true);
    expect(matchesKey("step-outcome.mint", "step-outcomeXmint")).toBe(false);
    expect(matchesKey("a*b*c", "a-x-b-y-c")).toBe(true);
    expect(matchesKey("a*b*c", "a-c-b")).toBe(false);
    expect(matchesKey("a*a", "a")).toBe(false);
    expect(matchesKey("a*a", "aa")).toBe(true);
  });

  it("order the state's matches, then the * state's, except in a final state", () => {
    const entry = (state: string): TransitionEntry => ({ to: [state], run: () => go(state) });
    const machine = stateMachine({
      initial: "a",
      final: ["done", "failed"],
      states: {
        a: { "step-outcome.*": entry("first"), "step-outcome.x": entry("second") },
        "*": { "step-outcome.*": entry("any"), "transaction-outcome": entry("ended") },
        failed: {},
      },
    });
    const keys = (state: string, name: string) =>
      machine.lookup(state, name).map((t) => t.eventKey);
    expect(keys("a", "step-outcome.x")).toEqual([
      "step-outcome.*",
      "step-outcome.x",
      "step-outcome.*",
    ]);
    expect(keys("b", "transaction-outcome")).toEqual(["transaction-outcome"]);
    expect(keys("failed", "transaction-outcome")).toEqual([]);
    expect(machine.handles("step-added.x")).toBe(false);
  });

  it("pass the event to the next match on pass(), discarding what the transition added", async () => {
    const machine = stateMachine({
      initial: "a",
      final: ["done", "failed"],
      states: {
        a: {
          "step-outcome.x": {
            to: [],
            run: ({ builder }) => {
              builder.lifecycle.add({
                stepStarts: [{ transactionTypeUrn: TYPE, items: [{ stepUrn: "tx1:discarded" }] }],
              });
              return pass();
            },
          },
        },
        "*": { "step-outcome.*": { to: ["failed"], run: () => go("failed") } },
      },
    });
    const result = await machine.evaluate(ctx, machine.input(record(), event("step-outcome.x")));
    expect(result).toMatchObject({ eventKey: "step-outcome.*", to: "failed" });
    expect(result!.body.lifecycle?.stepStarts).toBeUndefined();
  });
});

describe("evaluate", () => {
  const machine = stateMachine({
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: {
        "transaction-accepted": {
          to: ["settling"],
          run: startSettle,
        },
        "step-added": { to: [], run: () => stay() },
      },
    },
  });

  it("reads the state from the label, else the initial state", () => {
    const accepted = event("transaction-accepted");
    expect(machine.input(record(), accepted).state).toBe("start");
    expect(machine.input(record({ labels: { state: "settling" } }), accepted).state).toBe(
      "settling",
    );
  });

  it("writes the transition's rows and the state label in one body, rows create_or_ignore and labels create_or_update", async () => {
    const result = await machine.evaluate(
      ctx,
      machine.input(record(), event("transaction-accepted")),
    );
    expect(result).toMatchObject({
      from: "start",
      to: "settling",
      eventKey: "transaction-accepted",
    });
    expect(result!.body).toEqual({
      lifecycle: {
        stepStarts: [
          {
            transactionTypeUrn: TYPE,
            updateStrategy: "create_or_ignore",
            labelStrategy: "create_or_update",
            items: [{ stepUrn: "tx1:settle", causationUrn: `${TX}:event=transaction-accepted` }],
          },
        ],
        transactions: [label("settling")],
      },
    });
  });

  it("writes nothing for an unmatched event, or a stay that added nothing", async () => {
    expect(
      await machine.evaluate(ctx, machine.input(record(), event("leg-added.main"))),
    ).toBeUndefined();
    expect(
      await machine.evaluate(ctx, machine.input(record(), event("step-added.settle"))),
    ).toBeUndefined();
  });
});

describe("declared targets", () => {
  const machine = stateMachine({
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: { "transaction-accepted": { to: ["settling"], run: () => go("elsewhere") } },
      settling: {
        "step-outcome.settle": { to: ["done"], run: () => go("done") },
        "condition-signaled.settle.*": { to: ["done"], run: () => go("done") },
      },
      "*": { "step-outcome.*": { to: ["failed"], run: () => pass() } },
    },
  });

  it("refuse a move to a state the entry does not declare", async () => {
    await expect(
      machine.evaluate(ctx, machine.input(record(), event("transaction-accepted"))),
    ).rejects.toThrow("moved to elsewhere, which is not in its to: settling");
  });

  it("draw one arrow per source and target, and the * state as one node", () => {
    expect(machine.mermaid().split("\n")).toEqual([
      "stateDiagram-v2",
      '    state "any state" as anyState',
      "    [*] --> start",
      "    start --> settling: transaction-accepted",
      "    settling --> done: step-outcome.settle<br/>condition-signaled.settle.*",
      "    anyState --> failed: step-outcome.*",
      "    done --> [*]",
      "    failed --> [*]",
    ]);
  });
});

describe("eventProcessor", () => {
  const machine = stateMachine({
    initial: "start",
    final: ["done", "failed"],
    states: {
      start: {
        "transaction-accepted": {
          to: ["settling"],
          run: startSettle,
        },
      },
    },
  });
  const read = (tx?: Transaction): BulkQueryOutput => ({
    lifecycle: { transactions: [{ items: tx ? [tx] : [] }] },
  });
  const processorCtx = {
    config: {},
    getServiceClientOptions: () => ({ baseURL: "http://subledger" }),
  } as unknown as EventProcessorContext;
  const batch = (...names: string[]) =>
    names.map((n, i) => ({ idempotencyKey: `k${i}`, topic: "t", data: event(n) }));

  it("reads only for events a transition keys on, then writes the transition", async () => {
    const query = jest
      .spyOn(SubledgerClient.prototype, "bulkQuery")
      .mockResolvedValue(read(record()));
    const upsert = jest.spyOn(SubledgerClient.prototype, "bulkUpsert").mockResolvedValue({});
    await machine
      .eventProcessor()
      .processBatch(processorCtx, batch("step-added.settle", "transaction-accepted"));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatchObject({
      lifecycle: {
        transactions: [{ transactionTypeUrn: TYPE, equal: [{ field: "urn", value: TX }] }],
      },
      options: { includeChildren: true },
    });
    expect(upsert.mock.calls[0][0].lifecycle?.transactions).toEqual([label("settling")]);
  });

  it("builds the client from each batch's context", async () => {
    jest.spyOn(SubledgerClient.prototype, "bulkQuery").mockResolvedValue(read(record()));
    jest.spyOn(SubledgerClient.prototype, "bulkUpsert").mockResolvedValue({});
    const batchCtx = () =>
      ({
        config: {},
        getServiceClientOptions: jest.fn(() => ({ baseURL: "http://subledger" })),
      }) as unknown as EventProcessorContext;
    const first = batchCtx();
    const second = batchCtx();
    const processor = machine.eventProcessor();
    await processor.processBatch(first, batch("transaction-accepted"));
    await processor.processBatch(second, batch("transaction-accepted"));
    expect(first.getServiceClientOptions).toHaveBeenCalledTimes(1);
    expect(second.getServiceClientOptions).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed write so the stream retries", async () => {
    jest.spyOn(SubledgerClient.prototype, "bulkQuery").mockResolvedValue(read(record()));
    const upsert = jest.spyOn(SubledgerClient.prototype, "bulkUpsert");
    upsert.mockRejectedValueOnce(new Error("503 unavailable"));
    await expect(
      machine.eventProcessor().processBatch(processorCtx, batch("transaction-accepted")),
    ).rejects.toThrow("503");
  });

  it("reads the transaction and the signal a condition-signaled event reports in one query", async () => {
    const signaled = {
      ...event("condition-signaled.c.7", `${TX}:condition=c`),
      detail: { signalId: 7, waitKey: "w1", signalIdempotencyKey: "s7" },
    };
    const query = jest
      .spyOn(SubledgerClient.prototype, "bulkQuery")
      .mockReset()
      .mockResolvedValueOnce({
        lifecycle: {
          transactions: [{ items: [record()] }],
          signals: {
            items: [{ id: 7, idempotencyKey: "s7", waitKey: "w1", created: T0, source: "api" }],
          },
        },
      });
    const read = await readTransaction(new SubledgerClient(processorCtx), signaled);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0].lifecycle?.signals).toEqual({
      equal: [{ field: "idempotencyKey", value: "s7" }],
      limit: 1,
    });
    expect(read?.signal).toMatchObject({ id: 7 });
  });

  it("skips a transaction it cannot read", async () => {
    jest.spyOn(SubledgerClient.prototype, "bulkQuery").mockResolvedValue(read());
    const upsert = jest.spyOn(SubledgerClient.prototype, "bulkUpsert").mockClear();
    await machine.eventProcessor().processBatch(processorCtx, batch("transaction-accepted"));
    expect(upsert).not.toHaveBeenCalled();
  });
});
