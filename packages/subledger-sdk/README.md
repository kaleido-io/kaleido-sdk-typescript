# Kaleido Subledger TypeScript SDK

A TypeScript client for the Kaleido subledger service. Use it to read and write subledger records — parties, wallets and assets, books and journal entries, chain and token evidence, and the lifecycle of transactions — from standalone applications or from workflow engine providers.

This package is one of several Kaleido TypeScript SDK packages. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido TypeScript SDK Readme](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md)

## What this SDK provides

- **`SubledgerClient`** — typed client for the subledger service. The current release supports bulk query and bulk upsert across every collection.
- **`BulkUpsertBuilder`** — accumulates writes into one bulk upsert, naming each row once, with optional auto-flush
- **Types** — every schema in the service's OpenAPI document, by name (`Step`, `TransactionInput`, `QueryJSON`, …)
- **`errorCode(err)`** — the `KAxxxxxx` code of a failed request; `ErrorCodes` names the common ones
- **`@kaleido-io/subledger-sdk/state-machine`** — a state machine framework for handlers that drive lifecycle transactions from their events

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

## Lifecycle state machines

`@kaleido-io/subledger-sdk/state-machine` drives transactions of one lifecycle transaction type from that type's `lifecycle.events`. A handler is a state machine: state × event → transition. The state is the handler's own vocabulary, held in the transaction's `labels.state`; the event's name selects the transition; the transition reads the transaction, adds the rows to write to a builder, and returns the next state. Those rows and the new state label go out as one bulk upsert.

```typescript
import { go, pass, stateMachine, stepRef } from "@kaleido-io/subledger-sdk/state-machine";

// The handler's business refusals.
class Rejection extends Error {}

const stepOf = (transaction, name) => transaction.steps?.find((s) => s.name === name);

// Routing has no workflow: its transition does the work. Workflows perform accept and settle.
async function routePayment(ctx, { transaction, event }) {
  const type = transaction.transactionTypeUrn;
  const routing = stepRef(transaction, "routing");
  try {
    await route(ctx, transaction);
  } catch (err) {
    if (!(err instanceof Rejection)) throw err;
    ctx.builder.lifecycle.add({
      stepOutcomes: [
        {
          transactionTypeUrn: type,
          items: [{ stepUrn: routing, status: "failed", error: err.message }],
        },
      ],
      transactionOutcomes: [
        {
          transactionTypeUrn: type,
          items: [
            {
              transactionUrn: transaction.urn,
              status: "failed",
              error: err.message,
              causationUrn: event.urn,
            },
          ],
        },
      ],
    });
    return go("failed");
  }
  ctx.builder.lifecycle.add({
    stepOutcomes: [
      {
        transactionTypeUrn: type,
        items: [{ stepUrn: routing, status: "completed", causationUrn: event.urn }],
      },
    ],
    stepStarts: [
      {
        transactionTypeUrn: type,
        items: [{ stepUrn: stepRef(transaction, "accept"), causationUrn: event.urn }],
      },
    ],
  });
  return go("accept");
}

// The settle workflow, on completing, adds a `settle` condition keyed on its
// evidence; the indexer's signal for that evidence meets it.
function settled(ctx, { transaction, event }) {
  ctx.builder.lifecycle.add({
    transactionOutcomes: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [
          {
            transactionUrn: transaction.urn,
            status: "completed",
            causationUrn: stepOf(transaction, "settle").urn,
          },
        ],
      },
    ],
  });
  return go("done");
}

function startSettle(ctx, { transaction, event }) {
  if (stepOf(transaction, "accept")?.status !== "completed") return pass();
  ctx.builder.lifecycle.add({
    stepStarts: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [{ stepUrn: stepRef(transaction, "settle"), causationUrn: event.urn }],
      },
    ],
  });
  return go("settle");
}

function failOnFailedStep(ctx, { transaction, event }) {
  const step = transaction.steps?.find((s) => s.urn === event.subjectUrn);
  if (step?.status !== "failed") return pass();
  ctx.builder.lifecycle.add({
    transactionOutcomes: [
      {
        transactionTypeUrn: transaction.transactionTypeUrn,
        items: [
          {
            transactionUrn: transaction.urn,
            status: "failed",
            error: step.outcome?.error,
            causationUrn: step.urn,
          },
        ],
      },
    ],
  });
  return go("failed");
}

const payment = stateMachine({
  initial: "routing",
  final: ["done", "failed"],
  states: {
    routing: {
      "step-started.routing": { to: ["accept", "failed"], run: routePayment },
    },
    accept: {
      "step-outcome.accept": { to: ["settle"], run: startSettle },
    },
    settle: {
      "condition-signaled.settle.*": { to: ["done"], run: settled },
    },
    "*": {
      "step-outcome.*": { to: ["failed"], run: failOnFailedStep },
    },
  },
});

WorkflowEngineClient.fromConfigFile().eventProcessor("payments", payment.eventProcessor()).start();
```

### Definition

| Field       | Description                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial`   | The state of a transaction with no `labels.state`                                                                                                                                                               |
| `states`    | Transitions by state, then by event key: `{ to, run }`, the states the transition may move to and the function that decides. The `*` state applies in every state not in `final`, after the state's own entries |
| `final`     | Final states, for which the `*` state does not apply                                                                                                                                                            |
| `subledger` | Name of the subledger service binding; default `subledger`                                                                                                                                                      |

Three words name different things. A transaction's or step's `status` (`active`, `completed`, `failed`) is the service's, derived from its outcomes. Its state is the handler's position in its machine, held in `labels.state` in the handler's own vocabulary. The blockchain module's `State` entity is an on-chain state record, unrelated to either.

An event key is a glob over event names: `*` matches any run of characters, and everything else matches literally. `step-outcome.notify` matches that event only, `step-outcome.*` any step's outcome, `condition-signaled.mint.*` any signal meeting the `mint` condition, and `*` every event. A state's matching keys are tried in declaration order, then the `*` state's. A transition that returns `pass()` leaves the event to the next match, and what it added is discarded; `stay()` ends the search and writes what was added, if anything. A transition that moves to a state outside its `to` throws. `machine.mermaid()` draws the `to` lists as a mermaid `stateDiagram-v2`, with the `*` state as one "any state" node.

Lifecycle event names are `<eventType>.<member>`: `step-started.routing`, `step-outcome.mint`, `condition-signaled.mint.<signal id>`, `transaction-outcome`. The handler's own writes return as events, so a transition must read the record rather than trust the event: an event that matches no transition in the current state is ignored.

### Transitions and writes

A transition is `(ctx, { transaction, state, event, signal }) => Next`, synchronous or async. `transaction` is the transaction with its steps, legs and conditions; `state` is the machine's state; `event` is the lifecycle event being handled; `signal` is the signal a `condition-signaled` event reports. `ctx.config` is the handler's config, typed by `stateMachine<Config>(…)` and passed through from the provider unchecked. `ctx.subledger` is the subledger client's read side (`SubledgerReader`, its `bulkQuery`), and `ctx.builder` its write side: a `BulkUpsertBuilder` for that attempt alone, to which the transition adds the rows it writes, in the bulk upsert's own shape. The event processor writes them. Lifecycle sections are scoped by the transaction type (`transaction.transactionTypeUrn`); members name their `transactionUrn` and facts their `causationUrn`, usually the triggering event's URN. It returns what happens next: `go(state)` to move, `stay()` to keep the state, or `pass()` to leave the event to the next match. Each builds a `Next`, `{ action: "go", state }`, `{ action: "stay" }` or `{ action: "pass" }`.

The builder writes rows `create_or_ignore` and labels `create_or_update`, so evaluating an event twice writes the same rows, and the state label is rewritten with the same value. A transition can configure its own sections, for example `ctx.builder.lifecycle.configure({ stepStarts: { updateStrategy: "create_only" } })` to make a step start a claim; a unique conflict (`KA240201`) then fails the write, and the stream retries the batch. A fact names its step by `stepRef(transaction, name)`, the step's ref within the type.

The event processor relies on the stream delivering a transaction's events in order, one at a time, so the only overlap is a redelivered event. A host that evaluates one transaction's events in parallel needs a claim: `create_only` step starts cover part of it, and a record of each transition written with a check of the state it moved from would cover the rest.

The service derives no transaction outcome: a handler writes both endings.

### Hosts

`machine.eventProcessor()` returns an `EventProcessorDef` for a workflow engine stream over the type's `lifecycle.events`, delivering the event row as each stream event's data. For each event in a batch, in order, the processor reads the transaction in one bulk query (with its children, and for a `condition-signaled` event the signal it reports), runs the transition, and writes the body. Events no transition keys on are skipped without a read; other errors propagate so the stream retries the batch.

`machine.evaluate(ctx, machine.input(transaction, event, signal))` is the same evaluation without I/O: it returns the `EvaluationResult`: the compiled body and the states moved from and to.

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
