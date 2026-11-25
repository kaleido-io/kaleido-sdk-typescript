# Kaleido Subledger TypeScript SDK

A TypeScript client for the Kaleido subledger service. Use it to read and write subledger records — parties, wallets and assets, books and journal entries, chain and token evidence, the lifecycle of transactions, and data items — from standalone applications or from workflow engine providers.

This package is one of several Kaleido TypeScript SDK packages. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido TypeScript SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md)

## What this SDK provides

- **`SubledgerClient`** — typed client for the subledger service. The current release supports bulk query and bulk upsert across every collection.
- **`BulkUpsertBuilder`** — accumulates writes into one bulk upsert, naming each row once, with optional auto-flush
- **Types** — every schema in the service's OpenAPI document, by name (`Step`, `TransactionInput`, `QueryJSON`, …)
- **`errorCode(err)`** — the `KAxxxxxx` code of a failed request; `ErrorCodes` names the common ones, such as `UniqueConflict`
- **`@kaleido-io/subledger-sdk/state-machine`** — a state machine framework for processors that drive lifecycle transactions from their events

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

A bulk body groups collections by module: `registry`, `accounting`, `blockchain`, `token`, `lifecycle` and `data`. Collections written under a root (`bookUrn`, `chainUrn`, `tokenUrn`, `transactionTypeUrn` or `storeUrn`) take one entry per root; the others take a single entry.

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

The builder has one property per module: `registry`, `accounting`, `blockchain`, `token`, `lifecycle` and `data`. Each takes that module's upsert input: its part of the bulk body, without section settings.

### Builder API

| Method                             | Description                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<module>.add(input, duplicates?)` | Adds the input's items. Collections written under a root (`bookUrn`, `chainUrn`, `tokenUrn`, `transactionTypeUrn` or `storeUrn`) take one entry per root; the others take a single entry |
| `<module>.configure(settings)`     | Overrides the builder's `defaults` option for sections of the module, field by field                                                                                                     |
| `addFinalizer(fn)`                 | Runs `fn` after the next successful `execute()`                                                                                                                                          |
| `toBulkUpsert()`                   | The bulk body for the accumulated items                                                                                                                                                  |
| `execute()`                        | Sends the body and returns the `BulkUpsertOutput` (`undefined` if empty); items and finalizers are cleared whether it succeeds or throws                                                 |
| `autoFlush(n)`                     | A wrapper with the same module properties, whose `add` executes once `n` items are held                                                                                                  |
| `hasUpdates()`, `getCount()`       | Accumulated item state                                                                                                                                                                   |

`updateStrategy` is required; `labelStrategy` is required if any labels are provided.

Items for the same row are combined by `duplicates`: `MERGE` (default) deep-merges, `SKIP` keeps the first, `REPLACE` keeps the last. Refs are compared as written: a name and a full URN for the same parent are not combined, and the service rejects the request with `KA240225` when both resolve to the same URN.

## Data items

The data module holds payloads that a record learns after its creation, such as a counterparty's declared terms. A store fixes how its items are kept: `jsonScheme` (`unmodified`, or `rfc8785` to canonicalise JSON) and `hashScheme` (`sha256`, `hmac-sha256` or `unchecked`). Folders nest within a store, and an item sits in a store or one of its folders.

An item's payload, URI, encoding and hash are immutable; its labels and `info` are not. A reader finds an item by its labels in the same bulk query as the records it belongs to:

```typescript
b.data.add({
  stores: { items: [{ name: "payments", jsonScheme: "rfc8785", hashScheme: "sha256" }] },
  folders: [{ storeUrn: "payments", items: [{ name: "tx1" }] }],
  items: [
    {
      storeUrn: "payments",
      items: [
        {
          folderUrn: "tx1",
          name: "terms",
          payload: { amount: "100" },
          labels: { uetr: "demo-uetr-tx1" },
        },
      ],
    },
  ],
});

const found = await sl.bulkQuery({
  data: {
    items: [{ storeUrn: "payments", equal: [{ field: "label.uetr", value: "demo-uetr-tx1" }] }],
  },
});
```

## Lifecycle state machines

The lifecycle module of the subledger records each transaction through its life, up to its outcome: its steps, legs and conditions. A transaction type takes one of three shapes.

| Shape    | Use when                                                                     | What runs                                                           |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Record   | One process does the work in one call                                        | That process, writing the rows as it goes                           |
| Dispatch | The work runs as separate steps, chosen by the transaction's data            | A processor that runs the state machine, and runners for its steps  |
| React    | No single process sees everything that decides the transaction's next action | The processor and runners, and a stream for each source of evidence |

**Record.** The process writes the transaction, its steps and its outcome directly, and decides everything itself. A Record that outgrows one call moves to Dispatch by moving its sequencing into a state machine; the work itself carries over.

**Dispatch.** A state machine from `@kaleido-io/subledger-sdk/state-machine` decides the steps and their order, and dispatches each one by adding it to the transaction. A runner picks the step up from its `step-added` event, writes its start, does the work, and writes its outcome. A runner may hold the step open until its own work's effect lands, such as a chain transaction's receipt, and then write the outcome. A machine of one working state is enough:

```typescript
const transfer = stateMachine({
  initial: go("accepted"),
  states: {
    accepted: {
      steps: [
        "debit",
        { name: "notify", when: ({ updatedTransaction }) => !!updatedTransaction.labels.notify },
      ],
      then: go("completed"),
    },
    completed: { type: "final", outcome: "completed" },
    failed: { type: "final", outcome: "failed" },
  },
  on: { "step-outcome.*": ifFailed({ run: () => go("failed"), to: ["failed"] }) },
});
```

The machine also records what a user sees of the plan: the `state`, `plannedSteps` and `expectedStates` labels, and the diagram `mermaid()` draws.

**React.** The machine adds states and transitions `on` events from sources the transaction does not control. A transaction type needs them when:

- facts arrive unprompted, not as the effect of the step that is running, such as a counterparty's change to a shared smart contract;
- a request applies to the whole transaction, such as a cancel;
- the work is split across systems that do not call each other;
- a deadline applies: the lifecycle has no timers, so a scheduler signals it as one more source;
- several facts are waited on in no fixed order.

A source, such as an indexer, writes its evidence and signals a condition's `waitKey`. A transition reads the evidence and decides. A step whose effect another source records, such as a chain transaction an indexer records, stays open until a transition on that evidence concludes it with `concludeStep`. Its runner opens a condition named for the fact it waits on, such as `mint-indexed`, and labelled with the step. In the Dispatch shape, a runner may instead hold the step open until its own effect lands.

### Definition

A state machine is defined via `stateMachine(def: StateMachineDef)`. The state machine definition sets out the list of `states` for the transaction, along with the `steps` that may execute in each state and the transitions that run based on transaction events.

- A **state** is something that has become true of the transaction. Where parties share a transaction, the states are agreed between them, and often mirror states from a shared smart contract.
- A **step** is a unit of work to be done. Its row asks for the work; its start records that a runner took it up, and its outcome that the work ended.
- A **workflow** is the platform method for carrying out a step. A workflow has its own internal stages, but anything internal to a workflow is an operational detail and not a part of the lifecycle record.

A definition is comprised of:

| Field               | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `initial`           | The initial transition a transaction takes on its first evaluation, or the move it makes        |
| `states`            | Every state, simple and final, in display order                                                 |
| `on`                | Global transitions that apply in every non-final state, evaluated after the state's own         |
| `transactionFilter` | Optional filter to determine whether the machine drives a particular transaction                |
| `options`           | Optional `expectedStates`, which lists the states expected to follow a state, and `prepareStep` |

A state has a `type`:

| Type               | Fields                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| `simple` (default) | Its `steps`, its `then`, and its transitions `on` each event key                  |
| `final`            | Its `outcome`, `completed` or `failed`, the status the transaction concludes with |

A simple state either works or waits. A state with `steps` runs them, then moves on through its `then`. A state without steps has no `then`, and waits for an event in `on`.

The initial transition is `{ run, to }`, where `run` reads the transaction and its `transaction-accepted` event, adds any rows to write, and returns `go` to one of `to`. A result can stand in for it: `initial: go("received")` enters `received` with nothing added.

Event keys in `on` name lifecycle events, such as `step-outcome.settle` or `condition-signaled.settled.*`. `*` matches a whole segment, as in `step-outcome.*`. A transition is `{ run, to }`, where `run` reads the transaction and returns a result, and `to` lists the states it can move to. A transition without `to` cannot move the transaction; its `run` returns `stay` or `pass`. A result can also stand in for a transition, as in `then: go("settled")`.

A transition returns one of:

| Result                | Effect                                                   |
| --------------------- | -------------------------------------------------------- |
| `go(state, outcome?)` | Moves to `state`, and for a final state writes `outcome` |
| `stay()`              | Keeps the current state                                  |
| `pass()`              | Passes the event to the next matching transition         |

A transition receives a context and an input. The context is the environment: the handler's config, the subledger reader, the builder for the rows it writes, and the definition. The input is the transaction as read before the event, its state, the event, and `updatedTransaction`: the transaction's labels and leg names, including those written earlier in the event's evaluation. Hooks read labels and legs from `updatedTransaction`, and steps, their outcomes, conditions and info from `transaction`. For the transition that handles the event, `updatedTransaction` is the transaction as read. While the transaction passes through states in one evaluation, `updatedTransaction.labels` holds the `state`, `previousStates` and `plannedSteps` from before the event, since the machine writes them once at the end; `input.state` and a `when`'s `previousStates` are current. `prepareStep` and `expectedStates` also receive `updatedTransaction`.

`ifCompleted` and `ifFailed` run a transition only for a completed or failed step outcome.

### Steps

A state's `steps` lists the steps it may run, in order. A step is a name, or `{ name, when?, prepare? }`, where the optional `when` decides whether the transaction runs it. Each `when` is asked once, on entering the state, with the transaction, the updated transaction, the state it came from and the states it has left. The chosen steps are recorded in the `plannedSteps` label.

The chosen steps run one at a time. Entering the state adds the first. When one completes, the next is added; after the last, the state's `then` runs. With no step chosen, `then` runs on entry, so a transaction can pass through several states in one evaluation. A failed step does not complete, so nothing follows it: a transition on its outcome decides. The outcome of a step of a state the transaction has left does not advance anything.

A step completes when its outcome is written. A step workflow writes it when the work is finished. Where the work has an effect that lands later, a transition on the evidence writes it with `concludeStep`, completed or failed.

A transition on the completion of one of the state's own steps runs before the next step is added, and the sequence advances unless that transition moves the transaction.

A step is named by its transaction and its name, and every row is written `create_or_ignore`, so a step runs once per transaction and a redelivered event writes nothing new. A step that another state already added cannot be added again; the evaluation throws.

A step's `prepare(ctx, { transaction, state, event, updatedTransaction })` returns its labels and info, and runs each time the machine adds the step. The step is added on entering its state, or on the completion of the state's previous step, so `prepare` reads what earlier steps recorded. It may read evidence through `ctx.subledger`, under the rules in [Reading evidence](#reading-evidence). A runner can take its input from the labels and info `prepare` gives the step.

`options.prepareStep(step, { transaction, state, updatedTransaction })` then adds labels or info to every step before the machine writes it. It cannot rename the step. `stepNameOf` gives the name of a step a state declares.

### Entering a state

An active transaction's first evaluation, on its `transaction-accepted` event, takes the initial transition and enters the state it goes to. Until then the transaction ignores every other event. A transaction that concluded without a state, such as one written before the machine, is ignored, so a stream replayed from its start does not restart it.

Entering a state writes the `state`, `previousStates`, `expectedStates` and `plannedSteps` labels, once for the state the evaluation ends in, then adds the first chosen step. Entering a final state concludes the transaction with the state's `outcome` status and the move's `outcome`, such as its `error`. The outcome's `causationUrn` is the event, unless the move's outcome gives one. A move to a state that is not final cannot give an outcome.

`previousStates` lists, comma-separated, the states the transaction has left, in order, including those passed through. `expectedStates` lists, comma-separated in declared order, the states expected to follow, through each state's `then` and transitions. From a state that can reach a completed final state, it lists the reachable states that can also complete; from one that cannot, the reachable states that cannot. `findExpectedStates(def, state, { ignore })` computes it, where `ignore` names states that do not count as a way to complete. `options.expectedStates` replaces the rule.

A transaction in a state the definition lacks is logged and left unchanged.

### Reading evidence

A transition decides from its transaction, as read before the event, and from evidence it reads through the subledger reader. Other writers own that evidence and keep writing it while the machine runs, so a read can find more than the event reports. These rules keep such reads safe:

- Evidence is written once and then fixed: a label written `create_or_ignore`, a data item, an indexed chain row. A later read finds at least what an earlier read found.
- A source writes its evidence and the signal for it in one bulk upsert. A transition on the signal therefore finds the evidence.
- A transition on a `condition-signaled` event acts on the fact its condition names. Evidence of later facts may already be visible; the signals for those facts act on them.
- Data that changes, such as a position or its holds, can change between a transition's read and the landing of its rows. A condition the transition checked, such as funds being available, holds only where the write itself enforces it.

Rows added earlier in the same evaluation are held in the builder until the evaluation's body is written. `updatedTransaction` includes the labels and legs among them; a transition reads any other row it depends on from the builder.

### Usage

A lifecycle state machine is designed to be driven via a workflow engine event processor. Create a custom provider to register an event processor, and call `handleEvents` for each batch of delivered events:

```typescript
processBatch: async (engineCtx, events) => {
  const subledger = new SubledgerClient(engineCtx, "subledger");
  await handleEvents({ config: engineCtx.config, subledger }, [payment], events.map((e) => e.data));
},
```

`handleEvents` evaluates each event against the first machine whose `transactionFilter` accepts its transaction.

The processor and the runners consume separate streams. A step that waits for something only the processor writes never finishes when both share one ordered stream. A transaction type runs the processor, its runners, and a stream for each source of evidence. The processor needs only the subledger, so it can run in its own provider, apart from the runners and the credentials their work needs; one provider can also host all of them.

The processor's host delivers each transaction's events in order, one at a time, at least once. It acknowledges an event only after its write has landed, so the next event's evaluation reads it.

A runner is any consumer of `step-added` events that writes starts and outcomes through the subledger API, such as a workflow engine workflow or an external system. A step is `pending` until its runner writes its start, and `started` after. Delivery is at least once, so a runner's work is safe to repeat or keyed by its step, and it writes each step's start and outcome once. Several runners split the steps by name, with no step in two. A runner takes its input from the transaction and the step's row.

The machine owns these parts of a transaction:

- the labels `state`, `previousStates`, `plannedSteps` and `expectedStates` on the transaction, and `state` on each step;
- the steps, each named in the definition and written once per transaction;
- the transaction's outcome, written on entering a final state.

The [lifecycle state machine sample](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/lifecycle-state-machine-sample) is a simple example of a complete state machine.

## Exported types

Every component schema of the service's OpenAPI document is exported by its schema name — entities (`Transaction`, `Step`, `JournalEntry`, …), inputs (`TransactionInput`, …), bulk envelopes (`BulkUpsertInput`, `BulkQueryOutput`, …) and queries (`QueryJSON`, `FilterJSON`, …). Fields the service requires are required in the input types.

### Updating the generated types

`swagger/subledger.yaml` is a copy of `subledger/swagger.yaml` from firefly-enterprise; its first line names the source commit. After replacing it (keeping that header line), run `npm run schema` to regenerate `src/schema.ts`. `npm run lint` fails when the two disagree.

## License

Apache-2.0
