# Kaleido Subledger TypeScript SDK

A TypeScript client for the Kaleido subledger service. Use it to read and write subledger records — parties, wallets and assets, books and journal entries, chain and token evidence, and the lifecycle of transactions — from standalone applications or from workflow engine providers.

This package is one of several Kaleido TypeScript SDK packages. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido TypeScript SDK Readme](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md)

## What this SDK provides

- **`SubledgerClient`** — typed client for the subledger service. The current release supports bulk query and bulk upsert across every collection.
- **`BulkUpsertBuilder`** — accumulates writes into one bulk upsert, naming each row once, with optional auto-flush
- **Types** — every schema in the service's OpenAPI document, by name (`Step`, `TransactionInput`, `QueryJSON`, …)
- **`errorCode(err)`** — the `KAxxxxxx` code of a failed request; `ErrorCodes` names the common ones

Hosted and non-hosted operation, project scaffolding and the configuration model are shared with the other SDK packages and described in the [Kaleido SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/packages/kaleido-sdk/README.md).

## Installation

```bash
npm install @kaleido-io/subledger-sdk
```

Applications using several services can use the multi-service client instead, which pulls in all SDK packages:

```bash
npm install @kaleido-io/kaleido-sdk
```

## Service bindings

A service binding maps a name to the connection details of a service instance. The default binding name is `subledger`.

```yaml
service-bindings:
  subledger:
    bindingType: non-hosted
    url: https://myaccount.myinstance.kaleido.io/endpoint/e:my-env/s:my-subledger/rest
    auth:
      type: basic
      username: my-user
      password: my-api-key
```

In hosted mode the platform supplies the binding and the client connects through the workflow engine's service proxy.

## SubledgerClient

### Construction

```typescript
import { SubledgerClient } from "@kaleido-io/subledger-sdk";

// From a named service binding in config.yaml
const sl = new SubledgerClient("subledger");

// From the config file, optionally at an explicit path
const sl2 = SubledgerClient.fromConfigFile("subledger", "/path/to/config.yaml");

// From a workflow engine SetupContext, via ctx.getServiceClientOptions('subledger')
const slFromCtx = new SubledgerClient(ctx);
const slAltBinding = new SubledgerClient(ctx, "subledger-2");

// From explicit ServiceClientOptions
const slExplicit = new SubledgerClient({
  transport: "http",
  url: "https://myaccount.kaleido.io/.../rest",
  auth: { type: "basic", username: "user", password: "api-key" },
});
```

When constructed from a `SetupContext`, `getNewBulkUpsertBuilder()` passes `ctx.signal` to its upserts, so they cancel if the batch is aborted.

### Methods

| Method                             | Description                                                               |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `getStatus()`                      | Service status                                                            |
| `bulkUpsert(input, options?)`      | Writes any mix of collections in one request (`PUT /api/v1/bulk`)         |
| `bulkQuery(input, options?)`       | Queries any mix of collections in one request (`POST /api/v1/bulk/query`) |
| `getNewBulkUpsertBuilder(options)` | A new, empty `BulkUpsertBuilder` bound to this client                     |

## Bulk query and bulk upsert

A bulk body groups collections by module: `registry`, `accounting`, `blockchain`, `token` and `lifecycle`. Collections written under a root (`bookUrn`, `chainUrn`, `tokenUrn` or `transactionTypeUrn`) take one entry per root; the others take a single entry.

```typescript
const out = await sl.bulkUpsert({
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
  },
});

const result = await sl.bulkQuery({
  lifecycle: {
    transactions: [
      {
        transactionTypeUrn: "td-transfer",
        equal: [{ field: "label.uetr", value: "demo-uetr-tx1" }],
      },
    ],
  },
  options: { includeChildren: true },
});
```

Query results are `{ count, allItems, items }` per collection, or per root for collections written under one.

## BulkUpsertBuilder

```typescript
const b = sl.getNewBulkUpsertBuilder({
  defaults: { updateStrategy: "create_only", labelStrategy: "create_or_ignore" },
});

b.lifecycle.configure({ transactions: { options: { returnRows: true } } });

b.lifecycle.add({
  transactions: [{ transactionTypeUrn: "td-transfer", items: [{ name: "tx1" }] }],
  legs: [
    {
      transactionTypeUrn: "td-transfer",
      items: [
        {
          transactionUrn: "tx1",
          name: "main",
          assetUrn: "USD",
          amount: "100",
          fromUrn: "alice",
          toUrn: "bob",
        },
      ],
    },
  ],
});

const out = await b.execute();
```

The builder has one property per module: `registry`, `accounting`, `blockchain`, `token` and `lifecycle`. Each takes that module's upsert input: its part of the bulk body, without section settings.

### Builder API

| Method                             | Description                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<module>.add(input, duplicates?)` | Adds the input's items. Collections written under a root (`bookUrn`, `chainUrn`, `tokenUrn` or `transactionTypeUrn`) take one entry per root; the others take a single entry |
| `<module>.configure(settings)`     | Overrides the builder's `defaults` option for sections of the module, field by field                                                                                         |
| `addFinalizer(fn)`                 | Runs `fn` after the next successful `execute()`                                                                                                                              |
| `toBulkUpsert()`                   | The bulk body for the accumulated items                                                                                                                                      |
| `execute()`                        | Sends the body and returns the `BulkUpsertOutput`; items and finalizers are cleared whether it succeeds or throws                                                            |
| `autoFlush(n)`                     | A wrapper with the same module properties, whose `add` executes once `n` items are held                                                                                      |
| `hasUpdates()`, `getCount()`       | Accumulated item state                                                                                                                                                       |

`defaults.updateStrategy` is required; `labelStrategy` has no default, and the service rejects a section whose items carry labels without one. A section's settings resolve when the body is built, so `configure` can come before or after `add`. Configuring a section again with a different value throws. Defaults and `configure` settings persist across `execute()` calls.

Items for the same row, within a section and root, are combined by `duplicates`: `MERGE` (default) deep-merges, `SKIP` keeps the first, `REPLACE` keeps the last. A row is identified by its `name` and the parent refs that shape its URN; signals by `idempotencyKey`; step starts and outcomes by `stepUrn`; transaction outcomes by `transactionUrn`; endings (hold releases, wallet unassignments, state archivals, coin spends, lock releases) by the ref of the row they end; identifiers by `value`. Refs are compared as written: a name and a full URN for the same parent are not combined, and the service rejects the request with `KA240225` when both resolve to the same URN.

## Errors

A failed request carries a `KAxxxxxx` code. `errorCode(err)` returns it; `ErrorCodes` names the ones callers commonly branch on, such as `UniqueConflict` (`KA240201`) and `DuplicateUrn` (`KA240225`).

## Exported types

- **Schemas:** every component schema of the service's OpenAPI document, by its schema name — entities (`Transaction`, `Step`, `JournalEntry`, …), inputs (`TransactionInput`, …), bulk envelopes (`BulkUpsertInput`, `BulkQueryOutput`, …) and queries (`QueryJSON`, `FilterJSON`, …)
- **Builder:** `ModuleUpsertInput`, `ModuleSettings`, `SectionSettings`, `BulkModule`, `SectionOf`, `ItemOf`, `UpdateStrategy`, `LabelStrategy`, `DuplicateStrategy`, `ModuleBuilder`, `IBulkUpsertClient`

Fields the service requires are required in the input types.

### Updating the generated types

`swagger/subledger.yaml` is a copy of `subledger/swagger.yaml` from firefly-enterprise; its first line names the source commit. After replacing it (keeping that header line), run `npm run schema` to regenerate `src/schema.ts`. `npm run lint` fails when the two disagree.

## License

Apache-2.0
