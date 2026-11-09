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

A lifecycle tracks a transaction to its outcome, for as long as that takes and across every party involved, and decides at each change what happens next. A workflow does one party's piece of that work and ends; a wait is a condition on the record.

`@kaleido-io/subledger-sdk/state-machine` can be used to react to the lifecycle record and drive the transaction. A handler is a state machine: the transaction's current state is held in `labels.state`, and each written lifecycle event may select a transition. A transition may add entries to the transaction record, and may move the transaction to a new state.

- A **state** is something that has become true of the transaction. Where parties share a transaction, the states are agreed between them, and often mirror states from a shared smart contract.
- A **step** is a unit of work to be done, with a start and an outcome on the record.
- A **workflow** is the platform method for carrying out a step. A workflow has its own internal stages, but anything internal to a workflow is an operational detail and not a part of the lifecycle record.

The record is the source of truth. A handler decides from the record, not from the event that woke it. Every row is named from the transaction and written once, so a handler can run again safely. A signal that carries a condition's key meets it; a signal may repeat or arrive after the transaction has moved on.

The [lifecycle state machine sample](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/lifecycle-state-machine-sample) is a complete handler: a payment machine whose steps the machine starts in turn, run as a workflow engine event processor over the type's `lifecycle.events`.

### Definition

| Field               | Description                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial`           | The state of a transaction with no `labels.state`; one of `states`                                                                                                               |
| `states`            | Each non-final state's `steps` and its transitions `on` each event key                                                                                                           |
| `on`                | Transitions that apply in every non-final state, after the state's own                                                                                                           |
| `final`             | Final states, which have no steps or transitions and are not in `states`                                                                                                         |
| `transactionFilter` | Whether the machine drives a transaction, where several machines share a transaction type; for example `(tx) => tx.labels?.role === "originator"`. Defaults to every transaction |
| `options`           | `autoStartSteps`, which has the machine start each state's steps (see Steps)                                                                                                     |

A transaction's or step's `status` (`active`, `completed`, `failed`) is the service's, derived from its outcomes. Its state is the handler's, in the handler's own vocabulary.

A transition is `{ to, run }`, the states it may go to and the function that decides, or a fixed move such as `go("done")`.

Event names are the event type, then the member it concerns, if any: `transaction-outcome`, `step-outcome.mint`, `condition-signaled.mint.<signal id>`. A member's name may contain dots. The handler's own writes return as events.

An event key is an event name in which `*` stands for any whole part: `step-outcome.*` matches any step's outcome, `condition-signaled.mint.*` any signal meeting the `mint` condition. `stateMachine()` rejects a key that can match no event, and a `to` that names a state the definition neither defines nor lists in `final`.

For each event, the current state's matching transitions are tried in declaration order, then the machine's own `on`. `pass()` leaves the event to the next match and discards what the transition added; `stay()` keeps the state; `go(state)` goes to a state in the transition's `to`. `ifCompleted(t)` and `ifFailed(t)` run `t` only when the step the outcome names has that status, and pass otherwise. An event that matches no transition is ignored. `machine.mermaid()` draws the machine as a mermaid `stateDiagram-v2`.

### Steps

A state's `steps` list every step a transaction may do in it, in order. A step is added to the transaction, pending and labelled with its state, as soon as the handler knows it will happen, and starts when it is ready: its state is current and the state's earlier steps are done. A step that is never added is skipped, and a step's state is fixed once added.

`startNextStep(ctx, input, state)` starts the first of `state`'s pending steps, unless one of its steps is running or has failed. With `options: { autoStartSteps: true }`, the machine calls it after every event, for the state the transaction ends in, and `machine.handles(event)` also accepts the outcome of any defined step.

Write steps, starts and outcomes with the helpers, `addSteps`, `startStep`, `startNextStep`, `concludeStep` and `concludeTransaction`, rather than by hand: the rule recognises rows only in the form they write. Each takes the API's input, without the URNs it fills in. The service derives no transaction outcome: the transition that concludes the transaction writes it, and goes to a final state.

A wait on something outside the transaction is a state with no steps; two steps that cannot follow each other directly belong to two states. A wait that belongs to a step, such as a chain transaction's confirmation, is the step's own: the workflow run writes the condition and ends with the step started, and the transition judging the signal concludes the step.

### Transitions and writes

A transition's `run` is `(ctx, { transaction, state, event }) => Next`, synchronous or async. `ctx.config` is the handler's config, typed by `stateMachine<Config>(…)`; `ctx.subledger` reads the subledger; `ctx.builder` collects the rows the transition writes, in the bulk upsert's own shape. `conditionOf(input)` returns the condition a `condition-signaled` event met, and `stepUrn(transaction, name)` a step's full URN.

Rows are written `create_or_ignore` and labels `create_or_update`, except step labels, which are `create_or_ignore`, so evaluating an event twice writes the same rows. A transition can configure its own sections, for example `ctx.builder.lifecycle.configure({ stepStarts: { updateStrategy: "create_only" } })` to make a step start a claim; a unique conflict then fails the write, and the stream retries the batch.

### Hosts

`handleEvents(ctx, machines, events)` runs one or more machines on a batch of lifecycle events. It skips events no machine `handles()`, without a read. For each other event, in order, it reads the transaction, with its children, evaluates it with the first machine whose `transactionFilter` accepts the transaction, and writes the result. The machines' filters should together cover every transaction on the stream: an event whose transaction no filter accepts is skipped, with a warning. `ctx` is `{ config, subledger }`, where `subledger` reads and writes. It relies on a transaction's events arriving in order, one at a time. Errors propagate, so the stream retries the batch, and the batch's earlier events run again in the states they left their transactions in. `readTransaction(client, event)` reads one event's transaction.

`machine.evaluate(ctx, transaction, event)` is the evaluation without I/O, where `ctx` is `{ config, subledger }`. It returns `{ from, to, body }`, or `undefined` when it writes nothing.

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
