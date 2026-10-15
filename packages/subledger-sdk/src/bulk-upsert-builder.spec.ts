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

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BulkUpsertBuilder, DuplicateStrategy, IBulkUpsertClient } from "./bulk-upsert-builder.js";
import type { BulkUpsertInput } from "./schema.js";

const bulkUpsert = jest.fn<IBulkUpsertClient["bulkUpsert"]>();
const client: IBulkUpsertClient = { bulkUpsert };

const usd = { name: "USD", decimals: 2 };
const leg = {
  transactionUrn: "tx1",
  name: "main",
  assetUrn: "USD",
  amount: "100",
  fromUrn: "alice",
  toUrn: "bob",
};

describe("BulkUpsertBuilder", () => {
  let b: BulkUpsertBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    bulkUpsert.mockResolvedValue({});
    b = new BulkUpsertBuilder(client, { defaults: { updateStrategy: "create_or_ignore" } });
  });

  it("builds the td-transfer accept body", () => {
    // subledger/hack/td-transfer-demo.sh accept()
    const expected: BulkUpsertInput = {
      lifecycle: {
        transactions: [
          {
            transactionTypeUrn: "td-transfer",
            updateStrategy: "create_only",
            labelStrategy: "create_or_ignore",
            options: { returnRows: true },
            items: [{ name: "tx1", labels: { uetr: "demo-uetr-tx1" } }],
          },
        ],
        legs: [
          {
            transactionTypeUrn: "td-transfer",
            updateStrategy: "create_only",
            labelStrategy: "create_or_ignore",
            items: [leg],
          },
        ],
      },
    };

    const accept = new BulkUpsertBuilder(client, {
      defaults: { updateStrategy: "create_only", labelStrategy: "create_or_ignore" },
    });
    accept.lifecycle.configure({ transactions: { options: { returnRows: true } } }).add({
      transactions: [
        {
          transactionTypeUrn: "td-transfer",
          items: [{ name: "tx1", labels: { uetr: "demo-uetr-tx1" } }],
        },
      ],
      legs: [{ transactionTypeUrn: "td-transfer", items: [leg] }],
    });

    expect(accept.toBulkUpsert()).toEqual(expected);
    expect(accept.getCount()).toBe(2);
  });

  it("writes one section entry per root, and an unscoped section as a single entry", () => {
    const hold = (name: string) => ({ name, accountUrn: "a1", assetUrn: "USD", amount: "100" });
    b.accounting.add({
      books: { items: [{ name: "b1" }] },
      holds: [
        { bookUrn: "b1", items: [hold("h1")] },
        { bookUrn: "b2", items: [hold("h1")] },
      ],
    });
    b.accounting.add({ holds: [{ bookUrn: "b1", items: [hold("h2")] }] });

    expect(b.toBulkUpsert()).toEqual({
      accounting: {
        books: { updateStrategy: "create_or_ignore", items: [{ name: "b1" }] },
        holds: [
          { bookUrn: "b1", updateStrategy: "create_or_ignore", items: [hold("h1"), hold("h2")] },
          { bookUrn: "b2", updateStrategy: "create_or_ignore", items: [hold("h1")] },
        ],
      },
    });
  });

  it("resolves configured settings over the defaults when the body is built", () => {
    const party = { name: "p", type: "bank" };
    b.registry.add({ assets: { items: [usd] }, parties: { items: [party] } });
    b.registry.configure({
      assets: { updateStrategy: "create_only", options: { returnRows: true } },
    });
    b.registry.configure({ assets: { updateStrategy: "create_only" } });

    expect(b.toBulkUpsert().registry).toEqual({
      assets: { updateStrategy: "create_only", options: { returnRows: true }, items: [usd] },
      parties: { updateStrategy: "create_or_ignore", items: [party] },
    });
    expect(() => b.registry.configure({ assets: { updateStrategy: "create_or_replace" } })).toThrow(
      "Conflicting updateStrategy for registry.assets",
    );
  });

  it("applies the duplicate strategy to repeats of the same row", () => {
    const root = { transactionTypeUrn: "tt" };
    b.lifecycle.add({
      steps: [{ ...root, items: [{ transactionUrn: "tx1", name: "s", labels: { a: "1" } }] }],
      stepStarts: [{ ...root, items: [{ stepUrn: "tx1:s", info: { n: 1 } }] }],
    });
    b.lifecycle.add({
      steps: [
        {
          ...root,
          items: [
            { transactionUrn: "tx1", name: "s", labels: { b: "2" } },
            { transactionUrn: "tx2", name: "s" },
          ],
        },
      ],
    });
    b.lifecycle.add(
      { steps: [{ ...root, items: [{ transactionUrn: "tx2", name: "s", labels: { c: "3" } }] }] },
      DuplicateStrategy.SKIP,
    );
    b.lifecycle.add(
      { stepStarts: [{ ...root, items: [{ stepUrn: "tx1:s" }] }] },
      DuplicateStrategy.REPLACE,
    );

    const body = b.toBulkUpsert();
    expect(body.lifecycle?.steps?.[0].items).toEqual([
      { transactionUrn: "tx1", name: "s", labels: { a: "1", b: "2" } },
      { transactionUrn: "tx2", name: "s" },
    ]);
    expect(body.lifecycle?.stepStarts?.[0].items).toEqual([{ stepUrn: "tx1:s" }]);
    expect(b.getCount()).toBe(3);
  });

  it("identifies signals by idempotency key and endings by the row they end", () => {
    b.lifecycle.add({
      signals: {
        items: [
          { idempotencyKey: "k1", waitKey: "w" },
          { idempotencyKey: "k1", waitKey: "w" },
          { idempotencyKey: "k2", waitKey: "w" },
        ],
      },
    });
    b.accounting.add({
      holdReleases: [{ bookUrn: "b1", items: [{ holdUrn: "h1" }, { holdUrn: "h1" }] }],
    });
    expect(b.getCount()).toBe(3);
  });

  it("execute sends the body, runs finalizers and keeps configuration", async () => {
    const output = { registry: { assets: { created: ["urn:kld:asset=USD"] } } };
    bulkUpsert.mockResolvedValue(output);
    const finalizer = jest.fn<() => void>();
    b.registry
      .configure({ assets: { updateStrategy: "create_only" } })
      .add({ assets: { items: [usd] } });
    b.addFinalizer(finalizer);

    await expect(b.execute()).resolves.toBe(output);
    expect(bulkUpsert).toHaveBeenCalledWith(
      { registry: { assets: { updateStrategy: "create_only", items: [usd] } } },
      { signal: undefined },
    );
    expect(finalizer).toHaveBeenCalledTimes(1);

    const eur = { name: "EUR", decimals: 2 };
    b.registry.add({ assets: { items: [eur] } });
    await b.execute();
    expect(bulkUpsert.mock.calls[1][0]).toEqual({
      registry: { assets: { updateStrategy: "create_only", items: [eur] } },
    });
    expect(finalizer).toHaveBeenCalledTimes(1);
  });

  it("execute skips and clears finalizers when the upsert fails", async () => {
    bulkUpsert.mockRejectedValueOnce(new Error("KA240202: parent not found"));
    const finalizer = jest.fn<() => void>();
    b.registry.add({ assets: { items: [usd] } });
    b.addFinalizer(finalizer);

    await expect(b.execute()).rejects.toThrow("KA240202");
    expect(b.hasUpdates()).toBe(false);

    b.registry.add({ assets: { items: [usd] } });
    await b.execute();
    expect(finalizer).not.toHaveBeenCalled();
  });
});

describe("BulkUpsertAutoFlush", () => {
  it("flushes when the count reaches the threshold, keeping configuration", async () => {
    bulkUpsert.mockReset().mockResolvedValue({});
    const auto = new BulkUpsertBuilder(client, {
      defaults: { updateStrategy: "create_or_ignore" },
    }).autoFlush(2);
    auto.registry.configure({ assets: { updateStrategy: "create_only" } });
    const asset = (name: string) => ({ name, decimals: 2 });

    await auto.registry.add({ assets: { items: [asset("A")] } });
    await auto.registry.add({ assets: { items: [asset("B")] } });
    await auto.registry.add({ assets: { items: [asset("C")] } });
    expect(bulkUpsert).toHaveBeenCalledTimes(1);
    expect(auto.getTotalCount()).toBe(3);

    await auto.execute();
    expect(bulkUpsert.mock.calls[1][0]).toEqual({
      registry: { assets: { updateStrategy: "create_only", items: [asset("C")] } },
    });
  });
});
