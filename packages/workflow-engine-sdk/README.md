# Kaleido Workflow Engine TypeScript SDK

A TypeScript SDK for building handlers that integrate with the Kaleido workflow engine.
This is one of several SDK packages provided to interact with the Kaleido platform. For
details of other SDK packages or general information about Kaleido SDKs see the
[Kaleido TypeScript SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md).

Using the Workflow Engine SDK you can build applications called **providers** that
interact with the workflow engine. The provider types supported are:

- **Transaction handlers** — execute workflow stage actions when the engine sends
  transaction batches (business logic, external API calls, stage transitions).
- **Event sources** — poll or subscribe to external systems and emit events (with
  checkpoints) into the workflow engine.
- **Event processors** — receive event batches from the engine and run your processing
  logic against them, with optional setup hooks, typed config, and service-binding
  helpers — suited for anything from simple event logging to ingesting events into a
  datastore.

You write each of them with the same [handler API](#writing-handlers), whether the provider runs locally, as a container provider on the Kaleido platform, or as a snippet uploaded to a Kaleido TypeScript provider.

More information on the workflow engine programming model is available from the
[Kaleido platform docsite](https://docs.kaleido.io/platform/web3-middleware/workflowengine/).

## Running hosted or non-hosted

Providers built with the Workflow Engine SDK can run in one of two modes: hosted or
non-hosted.

Step-by-step instructions: **[Running locally](#running-locally)** (development) · **[Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform)** (production).

### Hosted

The provider is built as a Docker image which is uploaded to the Kaleido Artifact Registry.
A container provider service is created inside the Kaleido platform to instantiate an instance of
the provider which runs as a Kaleido managed service.

In hosted mode the provider has connection and auth context information automatically
provided to it by service bindings.

This is the intended usage mode for running a provider in production. See
[Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform) for build, push, and
deploy steps.

### Non-hosted

The provider runs locally on your development workstation, either as a TypeScript
application or as a Docker container. Connection information is provided as configuration
via non-hosted service bindings which contain the connection details required to connect
to Kaleido platform services.

Running in this mode is intended to allow you to iterate quickly during development of a
provider. It is not recommended to run in non-hosted mode for production use-cases. See
[Running locally](#running-locally) for setup and verification steps.


## Quick start

### Scaffolding from a template

The `kaleido-sdk` package allows you to scaffold a new or existing project from an
example to get started quickly.

Scaffold a new provider project from a template:

```bash
# Start from the workflow-engine-provider template
npx @kaleido-io/kaleido-sdk init <project-name> --template workflow-engine-provider

# Start from the ERC-20 indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template erc20-indexer

# Start from the Bitcoin indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template btc-indexer

# Start from the Native ETH indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template native-eth-indexer

# Start from the Canton CIP-56 indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template canton-cip56-indexer
```

Omit `--template` in an interactive terminal and you'll be prompted to choose one.

Scaffold into an existing project:

Omit the project name to copy template source files into the current directory
instead of creating a new one. Only the `src/` and `config/` directories are
merged in — root files (`tsconfig.json`, `Dockerfile`, etc.) are left untouched:

```bash
cd my-existing-project
npx @kaleido-io/kaleido-sdk init --template erc20-indexer
```

Any `@kaleido-io/*` dependencies required by the template are added to your
`package.json` automatically. Run `npm install` afterwards.

### What gets created on disk

When you scaffold a **new project**, you should see a layout like:

```text
my-project/
  config/
    config.sample.yaml
    provider-config.sample.yaml
  src/
    main.ts
    ... template-specific source files ...
  Dockerfile
  package.json
  README.md
  tsconfig.json
  vitest.config.ts
```

When you scaffold **into an existing project** (`init --template ...` with no project name), only template-owned source/config files are added:

```text
<existing-project>/
  config/
    config.sample.yaml
    provider-config.sample.yaml
  src/
    main.ts
    ... template-specific source files ...
```

In add-to-existing mode, your root project files are not overwritten (for example `tsconfig.json`, `Dockerfile`, `.gitignore`), and your existing `package.json` is updated with any missing `@kaleido-io/*` dependencies required by that template.

#### Scaffolded file purpose

| File | Purpose |
|---|---|
| `config/config.sample.yaml` | Platform connection settings. |
| `config/provider-config.sample.yaml` | Application-specific config template consumed by your application code. |
| `src/main.ts` | Starting point that wires SDK clients/handlers for the selected template. |
| `Dockerfile` | Container build for running the provider in deployment environments. |
| `tsconfig.json` | TypeScript compiler settings for the scaffolded project. |
| `vitest.config.ts` | Test runner configuration included by templates that ship tests. |

### Installation

If you do not wish to start from a template you can simply import the SDK directly:

```bash
npm install @kaleido-io/workflow-engine-sdk
```

If you are using multiple SDK packages you may wish to use the multi-service client:

```bash
npm install @kaleido-io/kaleido-sdk
```

Note that this will pull in all SDK packages as transitive dependencies.



## Writing handlers

Write handlers with the handler API: `defineTransactionHandler`, `defineEventSource` and `defineProcessor`. Each takes plain functions and returns a value you register on the client:

```typescript
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';
import { helloHandler } from './hello.js';
import { tickSource } from './tick-source.js';
import { echoProcessor } from './echo-processor.js';

WorkflowEngineClient.fromConfigFile()
  .transactionHandler('hello', helloHandler)
  .eventSource(tickSource)
  .eventProcessor('echo', echoProcessor)
  .start();
```

### Running the same handlers in a TypeScript provider

A file written this way also runs unchanged in a Kaleido TypeScript provider, where you upload the file instead of building an image. The same file works in both places when it:

- exports one handler, made with `defineTransactionHandler`, `defineEventSource` or `defineProcessor`, under any export name;
- imports only `@kaleido-io` SDK packages the TypeScript provider supplies, and other files of your own;
- calls other services through the handler's context (`ctx`), not through a `setup` hook, which a TypeScript provider doesn't run.

A handler's settings travel with it too. It reads them from `ctx.config`, `ctx.secrets` and `ctx.resources`, which your own provider fills from its config file and mounted secrets, and a TypeScript provider fills from the handler's entry in the service config. See [Config, secrets and resources](#config-secrets-and-resources).

This needs a TypeScript provider that provides `@kaleido-io/workflow-engine-sdk` 1.1.0-rc.1 or later. In a TypeScript provider, a handler registers under the name in the service config instead of the `.transactionHandler(name, …)` call. The console and `ksdk package` fill that in from the name the handler is defined with, or from the file's name when it has none. Keeping each handler in a file of its own, with the registration in a separate entry point like the one above, lets you develop and test it locally and then upload it as it is.

### Transaction handlers

`defineTransactionHandler` takes the handler's name and its actions, keyed by action name. Each action is a function of the stage's input:

```typescript
import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

export const helloHandler = defineTransactionHandler('hello', {
  hello: async (input: { name?: string }) => {
    if (!input.name) {
      throw new Error('name is required');
    }
    return { greeting: `Hello, ${input.name}!` };
  },
});
```

`input` is the result of the stage's `inputMap`, including directing fields such as `action` and `nextStage`. Declare the fields the action reads as the parameter's type.

What the action returns or throws decides what happens to the transaction:

| The action | The transaction |
|---|---|
| returns a value | completes the stage, with the value stored at the stage's `outputPath`, and moves to `nextStage` |
| returns `complete(output, { stage, events })` | completes the stage, moves to `stage` instead of `nextStage`, and emits `events` |
| returns `waiting({ deadline, output })` | stays in the stage until an event or the deadline wakes it |
| throws | fails the stage, with the message stored at `/error`, and moves to `failureStage` |
| throws `new StageError(message, { stage, data })` | fails the stage, moves to `stage` instead of `failureStage`, and stores `data` at `/errorData` |
| throws `new RetryableError(message)` | stays in the stage, and the engine tries the action again |

```typescript
import { complete, defineTransactionHandler, RetryableError, StageError, waiting } from '@kaleido-io/workflow-engine-sdk';

export const paymentHandler = defineTransactionHandler('payments', {
  'check-payment': async (input: { amount: number }) => {
    if (input.amount <= 0) {
      throw new StageError('amount must be positive', { stage: 'rejected', data: { amount: input.amount } });
    }
    if (input.amount > 10_000) {
      return complete({ review: true }, { stage: 'manual-review' });
    }
    return { approved: true };
  },
  'await-settlement': async (input: { paymentId: string }) => {
    const status = await lookUpSettlement(input.paymentId);
    if (status === 'unavailable') {
      throw new RetryableError('settlement service unavailable');
    }
    if (status === 'pending') {
      return waiting({ deadline: new Date(Date.now() + 60_000) });
    }
    return { settled: true };
  },
});
```

### The handler context

Each action gets a context as its second argument, one per transaction:

| Field | What it is |
|---|---|
| `ctx.transaction` | The transaction being handled, including its `transactionId`, `workflowId`, `state` and `authRef` |
| `ctx.getServiceClientOptions(bindingName)` | Resolves a [service binding](#service-bindings) as the transaction's caller |
| `ctx.signal` | An `AbortSignal` that aborts when the engine's deadline for the request passes |
| `ctx.requestId` | The ID of the request the transaction arrived in, for correlating logs |
| `ctx.providerName`, `ctx.handlerName` | Where the action is running |
| `ctx.config` | The handler's config. See [Config, secrets and resources](#config-secrets-and-resources). |
| `ctx.secrets`, `ctx.secret(name)` | The handler's secrets, by name. `ctx.secret(name)` throws for a name the handler has no secret for, naming the secrets it has but never their values. |
| `ctx.resources`, `ctx.resource(name)` | The handler's resources: files from where it's deployed, by name, as paths. `ctx.resource(name)` throws for a name the handler has no resource for. |

With a hosted binding, calls go through the platform as the user or application that submitted the transaction, so each call carries the caller's identity and needs no setup. `AssetManagerClient` and `SubledgerClient` accept the context and a binding name directly. For a service without a typed client, `GenericServiceClient` from `@kaleido-io/core-sdk` sends requests to paths relative to the service's base URL:

```typescript
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import { GenericServiceClient } from '@kaleido-io/core-sdk';
import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

export const listPoolsHandler = defineTransactionHandler('list-pools', {
  'list-pools': async (_input, ctx) => {
    const pools = await new AssetManagerClient(ctx, 'asset-manager').getPools();
    return { pools: pools?.items ?? [] };
  },
});

export const listKeysHandler = defineTransactionHandler('list-keys', {
  'list-keys': async (_input, ctx) => {
    const keys = await new GenericServiceClient(ctx, 'key-manager').get<{ items: { name: string }[] }>('/api/v2/keys');
    return { keys: (keys?.items ?? []).map((key) => key.name) };
  },
});
```

Event source polls and event processor batches get a context too, with the same binding lookup.

### Event sources

Providers that poll or subscribe to external systems and emit events (with checkpoints) into the workflow engine.

`defineEventSource` takes the source's name and its functions. Each poll gets the stream's config, the checkpoint to resume from and the stream itself, and returns the next checkpoint and any events:

```typescript
import { defineEventSource } from '@kaleido-io/workflow-engine-sdk';

export const counterSource = defineEventSource<{ lastId: number }>('counter', {
  poll: async ({ checkpoint, stream }) => {
    const lastId = (checkpoint?.lastId ?? 0) + 1;
    return {
      checkpoint: { lastId },
      events: [{ idempotencyKey: `${stream.streamId}-${lastId}`, topic: 'count', data: { value: lastId } }],
    };
  },
});
```

Including the stream ID in each idempotency key keeps two streams that share the source apart. Alongside `poll`, these are optional:

- `initialCheckpoint(config)`: the checkpoint a new stream starts from. Without it, the first poll gets `null`.
- `parseConfig(stream, config)`: checks and converts a stream's raw config. Throw to reject the stream.
- `onDelete(stream)`: cleans up when a stream that uses the source is deleted.

The poll's second argument is its context. `ctx.stream` identifies the stream, and `ctx.getServiceClientOptions(bindingName)` resolves bindings as the stream's owner, so a poll can call another service:

```typescript
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import { defineEventSource } from '@kaleido-io/workflow-engine-sdk';

export const poolWatcher = defineEventSource<{ seen: number }>('pool-watcher', {
  poll: async ({ checkpoint }, ctx) => {
    const pools = (await new AssetManagerClient(ctx, 'asset-manager').getPools())?.items ?? [];
    return {
      checkpoint: { seen: pools.length },
      events: pools.slice(checkpoint?.seen ?? 0).map((pool) => ({ idempotencyKey: pool.id, topic: 'pool-created', data: pool })),
    };
  },
});
```

The [`scheduled-workflow` sample](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/workflow-engine-provider/scheduled-workflow) uses an event source to run a workflow on a schedule.

### Event processors

Providers that receive event batches from the engine and run processing logic against them.

`defineProcessor` takes the processor's name and a function that handles each batch. Throw to fail the batch:

```typescript
import { defineProcessor, type EventProcessorEvent } from '@kaleido-io/workflow-engine-sdk';

interface Transfer { from: string; to: string; amount: string }

export const transferProcessor = defineProcessor('transfers', async (events: EventProcessorEvent<Transfer>[], ctx) => {
  for (const event of events) {
    await record(event.data, { signal: ctx.signal });
  }
});
```

Register it with `.eventProcessor('transfers', transferProcessor)`. The context has `ctx.getServiceClientOptions(bindingName)`, `ctx.signal`, `ctx.requestId`, `ctx.config`, `ctx.secrets` and `ctx.resources`, as for transaction handlers.

### Config, secrets and resources

A handler gets three kinds of settings from where it's deployed: `ctx.config`, an object of its own settings; `ctx.secrets`, string values by name; and `ctx.resources`, paths of files by name, such as a trust store or a schema. They describe how the handler is set up, so they're the same for every request it handles.

In your own provider, every handler sees the provider's config file, the one `CONFIG_FILE` names, as `ctx.config`. Secrets come from the credential sets mounted under `KALEIDO_SECRETS_DIR`: a credential set mounted at `<dir>/<name>/value` is the secret `<name>`, and any other file in its directory, such as a basic auth set's `username`, is `<name>/<file>`. A handler sees only the secrets it is registered with, so a handler registered without any sees none. To give one handler settings of its own, register it with them:

```typescript
WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('ledger-writer', ledgerWriter, {
    config: { book: 'primary' },
    secretNames: ['ledgerApiKey'],
    resources: { truststore: '/etc/ledger/truststore.p12' },
  })
  .start();
```

`config` and `resources` replace the provider-wide value for that handler, and any you leave out falls back to it. `secretNames` picks the handler's secrets from `KALEIDO_SECRETS_DIR` by name; to give a handler secret values directly instead, pass `secrets: { apiKey: '...' }`.

In a TypeScript provider, each handler's entry in the service config sets them: `config` inline or `configFile` from a JSON or YAML file, `secrets` from key credential sets, and `resources` from the service's file sets, mounted into the pod. The provider's own config file is never visible to handlers.

The three are optional in the context types, so that a context built by hand in a test needn't list them; a handler the SDK runs always has all three. Settings that vary per request, such as a workflow's config profiles or a stream's config, come from the workflow or the stream instead, not from `ctx.config`.

### Testing handlers

`invokeAction` from `@kaleido-io/workflow-engine-sdk/testing` runs one action the way the engine does, without a workflow engine. Pass only the action's own input; the stage's directing fields are filled in. It checks the action name and input type against the handler at compile time:

```typescript
import { describe, expect, it } from 'vitest';
import { EvalResult } from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';
import { paymentHandler } from './payment.js';

describe('check-payment', () => {
  it('approves a normal payment', async () => {
    const result = await invokeAction(paymentHandler, 'check-payment', { amount: 50 });
    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ approved: true });
  });

  it('sends a large payment to manual review', async () => {
    const result = await invokeAction(paymentHandler, 'check-payment', { amount: 50_000 });
    expect(result.customStage).toBe('manual-review');
  });
});
```

The result is what the engine receives: `result` (an `EvalResult`), `output`, `error`, `errorData`, `customStage`, `events` and `deadline`. The fourth argument sets what the action sees:

| Option | Sets |
|---|---|
| `transaction` | Fields of `ctx.transaction`, such as `authRef` or `state` |
| `bindings` | The client options `ctx.getServiceClientOptions(name)` returns, by binding name |
| `config` | `ctx.config` |
| `secrets` | `ctx.secrets` and `ctx.secret(name)` |
| `resources` | `ctx.resources` and `ctx.resource(name)` |
| `stageDirector` | The stage's directing fields. They default to `outputPath: '/output'`, `nextStage: 'next'` and `failureStage: 'failed'`. |
| `ctx` | Any other part of the context, such as `signal` |

To test an action that calls a service, point its binding at a local stand-in for the service, as the [`list-pools` sample's tests](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/workflow-engine-provider/list-pools) do:

```typescript
const result = await invokeAction(listPoolsHandler, 'list-pools', {}, {
  bindings: { 'asset-manager': { transport: 'http', url: fakeAssetManagerUrl } },
});
```

### Additional APIs in container providers

Container providers, and providers you run locally, also support the following APIs. They add:

- a `setup` hook that runs once before the provider connects, for example to create a stream or bootstrap resources;
- `EngineAPI`, for calling back into the workflow engine from a handler;
- init and close hooks, and full control of the reply sent to the engine.

Snippets for a TypeScript provider use the APIs above.

#### Transaction handlers with action maps


Register with the fluent builder on `WorkflowEngineClient.fromConfigFile()`. Pass a factory-built handler, or a registration object / closure from a helper function:

```typescript
import {
  WorkflowEngineClient,
  createTransactionHandler,
  InvocationMode,
  EvalResult,
} from '@kaleido-io/workflow-engine-sdk';

const actionMap = new Map([
  [
    'process',
    {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (_tx, input) => ({
        result: EvalResult.COMPLETE,
        output: { ok: true },
      }),
    },
  ],
]);

WorkflowEngineClient.fromConfigFile()
  .transactionHandler('my-handler', {
    handler: createTransactionHandler('my-handler', actionMap),
    setup: async (ctx) => {
      /* optional one-time init; ctx.config from provider-config.yaml */
    },
  })
  .start();
```

A closure or factory that returns `{ handler, setup? }` is also supported:

```typescript
function createMyHandler() {
  return {
    handler: createTransactionHandler('my-handler', actionMap),
    setup: async (ctx) => { /* ... */ },
  };
}

WorkflowEngineClient.fromConfigFile()
  .transactionHandler('my-handler', createMyHandler())
  .start();
```

##### EngineAPI

The `EngineAPI` interface allows transaction handlers to make API calls back to the workflow engine during processing.

```typescript
async function myHandler(transaction, input, engAPI: EngineAPI) {
  const results = await engAPI.submitAsyncTransactions(
    input.id,
    transaction.authRef,
    [
      {
        workflowId: 'flw:abc123',
        operation: 'process',
        input: { data: 'value' },
      },
    ],
  );

  return {
    result: EvalResult.COMPLETE,
    output: { submittedTxs: results },
  };
}
```

##### StageDirector pattern

For workflows with action-based routing and automatic stage transitions:

```typescript
import {
  BasicStageDirector,
  WithStageDirector,
} from '@kaleido-io/workflow-engine-sdk';

interface MyInput extends WithStageDirector {
  data: string;
}

class MyInputImpl implements MyInput {
  public stageDirector: BasicStageDirector;
  public data: string;

  constructor(input: any) {
    this.stageDirector = new BasicStageDirector(
      input.action,
      input.outputPath,
      input.nextStage,
      input.failureStage,
    );
    this.data = input.data;
  }
}

// A stage whose next step is a subflow sets `nextSubflow` instead of
// `nextStage` (never both); the reply then names the subflow to invoke.
//
// The SDK automatically wraps plain JSON objects from the engine
// with a `stageDirector` property, so you can also use plain objects:
const actionMap = new Map([
  [
    'myAction',
    {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction, input: any) => ({
        result: EvalResult.COMPLETE,
        output: { processed: input.data },
      }),
    },
  ],
]);
```

##### Complete example

```typescript
import {
  WorkflowEngineClient,
  WorkflowEngineConfig,
  createTransactionHandler,
  InvocationMode,
  EvalResult,
  addOp,
  ConfigLoader,
} from "@kaleido-io/workflow-engine-sdk";
import * as fs from "fs";
import * as yaml from "js-yaml";

interface ProcessInput {
  action: string;
  userId: string;
  amount: number;
}

async function main() {
  // Load config (your application handles file loading)
  const configFile = fs.readFileSync("./config.yaml", "utf8");
  const config: WorkflowEngineConfig = yaml.load(
    configFile,
  ) as WorkflowEngineConfig;

  // SDK transforms config
  const clientConfig = ConfigLoader.createClientConfig(
    config,
    "payment-service",
  );

  // Create client
  const client = new WorkflowEngineClient(clientConfig);

  // Define actions
  const actionMap = new Map([
    [
      "validatePayment",
      {
        invocationMode: InvocationMode.PARALLEL,
        handler: async (transaction, input: ProcessInput) => {
          if (input.amount <= 0) {
            return {
              result: EvalResult.HARD_FAILURE,
              error: new Error("Invalid amount"),
            };
          }

          return {
            result: EvalResult.COMPLETE,
            output: { validated: true },
            extraUpdates: [
              addOp("/validation", { valid: true, timestamp: new Date() }),
            ],
          };
        },
      },
    ],

    [
      "processPayment",
      {
        invocationMode: InvocationMode.PARALLEL,
        handler: async (transaction, input: ProcessInput) => {
          const paymentResult = await processPayment(
            input.userId,
            input.amount,
          );

          return {
            result: EvalResult.COMPLETE,
            output: paymentResult,
            triggers: [{ topic: "payment.completed" }],
          };
        },
      },
    ],
  ]);

  // Create handler
  const handler = createTransactionHandler("payment-handler", actionMap)
    .withInitFn(async (engAPI) => {
      console.log("Payment handler initialized");
    })
    .withCloseFn(() => {
      console.log("Payment handler closed");
    });

  // Register and connect
  client.registerTransactionHandler("payment-handler", handler);
  await client.connect();

  console.log("Payment service ready");
}

main().catch(console.error);
```

#### Event sources with createEventSource

`createEventSource(name, pollFn)` returns a builder. The poll function receives the stream's config, the checkpoint and the poll's `authRef`, and returns `{ checkpointOut, events }`. The builder's `withInitialCheckpoint`, `withConfigParser` and `withDeleteFn` match `defineEventSource`'s optional functions, and `withInitFn` gives the source an `EngineAPI`:

```typescript
import { WorkflowEngineClient, createEventSource } from '@kaleido-io/workflow-engine-sdk';

const myEventSource = createEventSource('my-event-source', async (config, checkpointIn) => ({
  checkpointOut: { lastId: (checkpointIn?.lastId ?? 0) + 1 },
  events: [{ idempotencyKey: 'evt-1', topic: 'my-topic', data: { value: 1 } }],
}))
  .withInitFn(async (engineApi) => { /* keep engineApi to submit transactions later */ });

WorkflowEngineClient.fromConfigFile()
  .eventSource(myEventSource)
  .start();
```

You can also pass any object that implements `EventSource`.

#### Event processors with setup hooks


Use the fluent `.eventProcessor()` builder method. The batch function receives an `EventProcessorContext` with:

- `ctx.config` — typed access to the handler's config: your `provider-config.yaml`, or what the handler was registered with
- `ctx.secrets`, `ctx.resources` — the handler's secrets and resources (see [Config, secrets and resources](#config-secrets-and-resources))
- `ctx.getServiceClientOptions(bindingName)` — resolve a service binding (works for both hosted and non-hosted bindings)
- `ctx.signal` — per-request `AbortSignal` that respects the WFE request deadline
- `ctx.requestId` — per-batch request ID for correlation logging

An optional `setup` hook runs once before the WFE connection is established (or on deploy trigger in `deferred` mode). Use it to create streams, bootstrap resources, or run one-time initialisation. **`setup` must be idempotent** — it may be called more than once (e.g. on reconnect or re-deploy), so operations inside it should be safe to repeat, such as using `create_or_ignore` upserts or `ensureStream` which is designed for this purpose.

```typescript
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';

interface MyConfig {
  batchSize: number;
}

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('my-processor', {
    setup: async (ctx) => {
      /* ensureStream, bootstrap resources, etc. */
    },
    processBatch: async (ctx, events) => {
      const { batchSize } = ctx.config;
      for (const event of events) await persist(event, batchSize);
    },
  })
  .start();
```

Pass an inline definition or a class instance that satisfies `EventProcessorDef`:

```typescript
class MyProcessor {
  async setup(ctx) { /* ... */ }
  async processBatch(ctx, events) { /* ... */ }
}

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('my-processor', new MyProcessor())
  .start();
```

Use `createEventProcessor` for the factory style:

```typescript
import { WorkflowEngineClient, createEventProcessor } from '@kaleido-io/workflow-engine-sdk';

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('my-processor', createEventProcessor(
    async (ctx, events) => {
      for (const event of events) await persist(event);
    },
  ))
  .start();
```

##### Example: building an indexer with the Asset Manager SDK

A common pattern is using an event processor to ingest batched blockchain events into an external system — for example the [Kaleido Asset Manager](https://docs.kaleido.io/platform/web3-middleware/asset-manager/), a database, or any other datastore. The `setup` hook is the right place to bootstrap resources, call `ensureStream` to create the connector stream on first deploy, and any other one-time work. The `processBatch` function then maps each event to the appropriate write operations on the target system.

```typescript
import { WorkflowEngineClient, createEventProcessor } from '@kaleido-io/workflow-engine-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';

interface MyConfig {
  contractAddress: string;
  stream: { connectorBindingName: string; name: string; factory: string; eventSourceConfig: unknown };
}

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('erc20-indexer', createEventProcessor(
    async (ctx, events) => {
      const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder();
      for (const event of events) {
        // map event.data to upsert operations...
        builder.upsertTransfer({ /* ... */ });
      }
      await builder.execute();
    },
    async (ctx) => {
      // Bootstrap the asset pool and create the connector stream on first deploy
      const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder();
      builder.upsertAsset({ name: 'my-token', updateType: 'create_or_ignore' });
      await builder.execute();

      await new EVMConnectorClient(ctx.config.stream.connectorBindingName).ensureStream(ctx, {
        factory: ctx.config.stream.factory,
        name: ctx.config.stream.name,
        eventSourceConfig: ctx.config.stream.eventSourceConfig,
      });
    },
  ))
  .start();
```

For larger indexers, the class form is often cleaner — see the full working examples in [`samples/erc20-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/erc20-indexer), [`samples/btc-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/btc-indexer), [`samples/native-eth-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/native-eth-indexer), and [`samples/canton-cip56-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/canton-cip56-indexer).

## Configuration Model

Most provider flows use two config files:

- `config.yaml` (platform connectivity and service bindings)
- `provider-config.yaml` (your app-specific config)

This separation lets one codebase run in different environments by changing config only. For example:

- local provider running from Docker on a developer machine
- hosted provider running from a published image in Kaleido infrastructure

In both cases, your SDK usage can stay the same; only configuration values change.

### Platform config (`config.yaml`)

```yaml
workflow-engine:
  providerName: my-provider
  url: https://wfe.example.com
  auth:
    type: token
    token: ${WFE_TOKEN}
    scheme: Bearer

service-bindings:
  asset-manager:
    bindingType: non-hosted
    url: https://am.example.com/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer

  # Hosted binding example (resolved via ws-proxy)
  evm-connector:
    serviceType: EVMConnectorService
    bindingType: hosted
    id: svc-connector-001
```

### Service bindings

A service binding provides a mapping between the name of a service and its connection
information. Because this is held in config, you can swap between hosted bindings (where
connectivity information is automatically provided by the platform) and non-hosted
bindings (where you provide the connection information).

This means that you can seamlessly transition between running an application locally on
your development workstation in order to iterate quickly and running hosted within the
Kaleido platform.

When constructing a client you can specify the name of a service binding in order to have
the client configured with the appropriate connection for that service. For example:

```typescript
const amClient1 = AssetManagerClient.fromConfigFile('assetManager1');
const amClient2 = AssetManagerClient.fromConfigFile('assetManager2');
```

```yaml
service-bindings:
  assetManager1:
    bindingType: non-hosted
    url: https://am.example.kaleido.cloud/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer
  assetManager2:
    bindingType: non-hosted
    url: https://am2.example.kaleido.cloud/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer
```

The exception to this pattern is the connection to the workflow engine itself. The
workflow engine is a singleton and this connection is also managed through the Provider
Proxy running on the Kaleido platform, therefore it has its own first-class stanza in the
configuration file. The workflow engine connection is defined using the top-level
`workflow-engine` root key in the config YAML file.

**Example - with basic auth:**
```yaml
workflow-engine:
  providerName: my-service
  url: http://localhost:5503
  auth:
    type: basic
    username: my-user
    password: my-password
  # maxRetries: undefined = infinite reconnection (recommended)
  # retryDelay: "2s" (time string: ms, s, m, h)
  retryDelay: 2s
```

**Example — outbound with token auth:**

```yaml
workflow-engine:
  providerName: my-service
  url: http://localhost:5503
  auth:
    type: token
    token: dev-token-123
    header: X-Kld-Authz   # optional, defaults to Authorization
    scheme: ""            # optional, e.g. "Bearer" for "Bearer <token>"
  retryDelay: 2s
```

When you are running in `hosted` mode the platform instead uses a WebSocket connection to
communicate with the workflow engine. The configuration for this WebSocket connection is
automatically generated by the platform when you create a Provider service.


### Provider config (`provider-config.yaml`)

This file is for your own application settings (batch size, allowlists, polling windows,
etc.), not platform connection details. When you are implementing a provider the
configuration is automatically made available to you as `ctx.config`. For example:

```yaml
batchSize: 50
allowlist:
    - '0x0000000000000000000000000000000000000001'
    - '0x0000000000000000000000000000000000000002'
```

```ts
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';

interface MyConfig {
  batchSize: number;
  allowlist: string[];
}

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .eventProcessor('my-processor', {
    async processBatch(ctx, events) {
      const { batchSize, allowlist } = ctx.config;
      // use batchSize, allowlist...
    },
  })
  .start();
```

### Environment Variables

By default configuration is sourced from the following environment variables:

- `KALEIDO_CONFIG_FILE` — path to `config.yaml` (preferred). Used by `fromConfigFile()` when no path argument is provided.
- `CONFIG_FILE` — path to `provider-config.yaml` (app-specific settings loaded by the Workflow Engine client)
- `KALEIDO_SECRETS_DIR` — directory of mounted credential sets, which handlers are given secrets from by name

Using these environment variables means that you can inject configuration into a Docker
container at development time. When running hosted within the Kaleido platform, the
platform writes service-binding configuration to `KALEIDO_CONFIG_FILE` and writes the
provided config file into `CONFIG_FILE`.

## Core concepts

### WorkflowEngineClient

The main entry point that manages:

- Handler registration (transaction handlers, event sources, and event processors)
- Connection lifecycle
- Automatic reconnection and re-registration
- Message routing between engine and handlers


Obtaining a client:

From config file (recommended):
```typescript
const client = WorkflowEngineClient.fromConfigFile();
```

From a non-default config file:
```ts
const client = WorkflowEngineClient.fromConfigFile('/path/to/file.yaml');
```

Explicit config:
```typescript
const client = new WorkflowEngineClient({
  url: "ws://localhost:5503/ws",
  providerName: "my-service",
  authToken: "your-token",
  authHeaderName: "X-Kld-Authz", // Optional, defaults to Authorization
  reconnectDelay: 2000, // Optional, ms between reconnect attempts
  maxAttempts: undefined, // Optional, undefined = infinite retries (recommended)
});
```

Usage:
```ts
// Register handlers
client.registerTransactionHandler("handler-name", transactionHandler);
client.registerEventSource("source-name", eventSource);

// Connect
await client.connect();

// Check connection status
if (client.isConnected) {
  console.log("Connected!");
}

// Disconnect
client.disconnect();
```

## Logging

The SDK uses the structured logger from `@kaleido-io/core-sdk`:

```typescript
import { newLogger } from '@kaleido-io/core-sdk/log';

const log = newLogger('my-component');

log.debug('Debug message', { metadata: 'value' });
log.info('Info message', { userId: 123 });
log.warn('Warning message', { reason: 'low memory' });
log.error('Error message', { error: err.message });
```

## Error handling

### Handler errors

With the handler API, an action fails its stage by throwing. Throw a `StageError` to choose the stage or attach data, or a `RetryableError` to have the engine try again; see [Transaction handlers](#transaction-handlers). An event processor fails its batch by throwing, and an event source poll that throws reports the error to the engine.

With an action map, return the `EvalResult` yourself:

```typescript
handler: async (transaction, input) => {
  try {
    const result = await riskyOperation(input);
    return { result: EvalResult.COMPLETE, output: result };
  } catch (error) {
    if (isTransient(error)) {
      return { result: EvalResult.TRANSIENT_ERROR, error: error as Error };
    }
    return { result: EvalResult.HARD_FAILURE, error: error as Error };
  }
};
```

### Connection errors

The client automatically handles WebSocket disconnections, reconnection with backoff, handler re-registration on reconnect, and connection health monitoring.

```typescript
if (!client.isConnected) {
  console.warn('Client disconnected, will auto-reconnect');
}
```

## Multiple handlers

A single provider can register any number of handlers. They all share one connection to the workflow engine:

```typescript
WorkflowEngineClient.fromConfigFile()
  .transactionHandler('hello', helloHandler)
  .transactionHandler('payments', paymentHandler)
  .eventSource(counterSource)
  .eventSource(poolWatcher)
  .eventProcessor('transfers', transferProcessor)
  .start();
```

## Troubleshooting

### Handler not registered

**Problem**: `No connections for handler 'my-handler'`

**Solution**: Ensure handler is registered before creating workflow or ensure connector is running

```typescript
// Register BEFORE submitting workflows
client.registerTransactionHandler("my-handler", handler);
await client.connect();
// Now workflows can use this handler
```

### Connection timeouts

**Problem**: Client fails to connect or times out

**Solution**: Check workflow engine URL and authentication

```typescript
// Verify URL format (should include ws:// or wss://)
url: "ws://localhost:5503/ws"; // ✓ Correct
url: "localhost:5503"; // ✗ Wrong

// Check authentication
authToken: process.env.AUTH_TOKEN; // Ensure token is valid
```

### Event source not polling

**Problem**: Event stream created but no events emitted

**Solution**:

1. Check stream is started: `"started": true`
2. Verify handler name matches: `listenerHandler: 'my-event-source'`
3. Check provider name matches: `listenerHandlerProvider: 'my-service'`
4. Ensure event source is registered before creating stream

## Deploying and running providers

Detailed runbooks for the two modes in [Running hosted or non-hosted](#running-hosted-or-non-hosted). Configure bindings and app settings first via the [Configuration Model](#configuration-model).

## Running locally

Use **non-hosted** mode to develop a provider on your workstation. Your process connects **outbound** to the workflow engine and to any **non-hosted** service bindings in `config.yaml`. Kaleido does not run the provider binary for you in this mode.

This flow applies to providers built with `@kaleido-io/workflow-engine-sdk` (transaction handlers, event sources, and event processors). Event processors that ingest blockchain events often also use `@kaleido-io/asset-manager-sdk` and `@kaleido-io/connector-sdk`; the same local run steps apply.

### Prerequisites

A Kaleido environment with the services your provider needs, for example:

- **Workflow engine** (your provider connects to it outbound)
- **Provider proxy** (for routing when testing against a remote environment)
- **Asset manager**, **connectors**, or other services referenced in `service-bindings`

Scaffold a project (recommended):

```bash
npx @kaleido-io/kaleido-sdk init my-provider --template workflow-engine-provider
# or: erc20-indexer, btc-indexer, native-eth-indexer, canton-cip56-indexer
cd my-provider
```

Scaffolded templates include `npm run start:dev`, a `Dockerfile`, and sample files under `config/`.

### Steps

**1. Install dependencies**

```bash
npm install
```

**2. Create configuration files**

```bash
cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml
```

**3. Edit `config/config.yaml`**

Set the outbound workflow engine connection and non-hosted service bindings. The `workflow-engine.providerName` must match the name registered in your provider code.

Example (non-hosted):

```yaml
workflow-engine:
  providerName: my-provider
  url: http://localhost:5503          # or your environment's WFE URL
  auth:
    type: token
    token: ${WFE_TOKEN}
    scheme: Bearer

service-bindings:
  asset-manager:
    bindingType: non-hosted
    url: https://am.example.com/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer

  evm-connector:
    bindingType: non-hosted
    url: https://evm-connector.example.com
    auth:
      type: token
      token: ${CONNECTOR_TOKEN}
      scheme: Bearer
```

Point the SDK at this file (optional if your app defaults to `./config/config.yaml`):

```bash
export KALEIDO_CONFIG_FILE=./config/config.yaml
```

**4. Edit `config/provider-config.yaml`**

Application settings only — batch sizes, stream filters, contract addresses, allowlists, etc. In handlers this is available as `ctx.config`. This file is **not** platform connectivity.

```bash
export CONFIG_FILE=./config/provider-config.yaml
```

**5. Start the provider**

```bash
npm run start:dev
```

(`start:dev` uses `tsx` in scaffolded templates; no build step required for local iteration.)

**6. Verify**

- Logs show handler registration and a successful connection to the workflow engine.
- The provider appears in the **Workflow engine** provider list in the Kaleido UI.
- **Event processors with streams:** if `provider-config.yaml` defines a `stream` block, confirm `setup()` creates the connector stream on first run (check connector UI or logs).
- **Transaction handlers:** submit a test workflow that invokes your handler (see [`samples/workflow-engine-provider`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/workflow-engine-provider)).

Working config examples per template: [`samples/`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/).

---

## Hosting on the Kaleido platform

Use **hosted** mode for production. You build an OCI image, push it to your Kaleido **Artifact registry**, and create a **Provider** service. The platform injects hosted **service-bindings** and connects your provider inbound via the **Provider proxy** (WebSocket through the proxy, not outbound from your laptop).

Scaffolded templates include a `Dockerfile` (distroless Node 22 on `linux/amd64`) and npm scripts for packaging and promotion.

### Prerequisites

In addition to the services your provider uses:

- **Artifact registry** with an artifact **namespace** created
- **Provider proxy** service

Convert provider config to JSON for the Provider service UI (do this whenever you change app settings for upload):

```bash
yq -o=json config/provider-config.yaml > config/provider-config.json
```

### npm scripts (scaffolded templates)

| Script | Purpose |
|---|---|
| `npm run package:docker` | Build OCI image locally (`linux/amd64`) |
| `npm run package:podman` | Same, using Podman |
| `npm run promote:docker` | Tag and push to `$ARTIFACT_REGISTRY/...:$IMAGE_TAG` |
| `npm run promote:podman` | Same, using Podman |
| `npm run promote:crane` | Copy an existing image from `$SOURCE_REGISTRY` via Crane |
| `npm run patch-provider-runtime` | *(optional)* PATCH runtime image via platform API |

Image names in these scripts match the scaffolded project name (e.g. `erc20-indexer`); adjust `package.json` if you rename the project.

### 1. Building an OCI image

```bash
npm run package:docker   # or package:podman for Podman users
```

> **NOTE:** the image is built on `linux/amd64` for compatibility with the Kaleido platform. You will need to ensure that your build environment is compatible with `linux/amd64` for building the image. On macOS with Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) on `linux/amd64` for a minimal, shell-free runtime — required for hosting on the Kaleido platform.

### 2. Pushing to the artifact registry

Log in to the artifact registry for your environment:

```bash
docker login my-registry.my-kaleido.io
```

Push with a **new immutable tag** each release:

```bash
export IMAGE_TAG=v1-$(date +%Y%m%d%H%M%S)
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
npm run promote:docker   # or promote:podman, or promote:crane if copying from another OCI registry
```

### 3. Deploying the provider

1. Go to the Kaleido platform UI within your running environment.
2. Navigate to the **Operations and resources** page.
3. Click the **+** button on the **Services** section to create a new service.
4. Select the **Provider** service type.
5. After you have named your service:
   - **a.** Select your uploaded provider artifact **tag** from your namespaced repository.
   - **b.** Drag and drop `config/provider-config.json` into the configuration file input box.
6. Finish creating the **Provider** service.
7. While the provider is provisioning, open the underlying **Provider** runtime and view **Logs** to ensure the provider is running correctly.
8. Confirm the provider is connected in your **Provider proxy** service and registered in the **Workflow engine** provider list.

At runtime the platform sets `KALEIDO_CONFIG_FILE` (hosted service bindings) and `CONFIG_FILE` (your uploaded provider config). Do not bake environment-specific URLs into the image for hosted bindings.

### 4. Streaming events to the provider (event processors)

Event processors that ingest blockchain events typically call `ensureStream` in `setup()` using the `stream` block in `provider-config.yaml` (via `@kaleido-io/connector-sdk`). On first startup the stream is created or updated to deliver batches to your registered handler.

Event path: **connector** → workflow engine **stream** → your **event processor** `processBatch` handler → (often) **Asset manager** bulk upsert.

If you need to create or adjust a stream manually, use the connector service UI and the appropriate stream factory, for example:

| Chain | Connector | Common factory |
|---|---|---|
| EVM (contracts / logs) | EVM connector | `evmTransactions` |
| EVM (native ETH) | EVM connector | `nativeEthTransactions` |
| Bitcoin | BTC connector | `transactionEvents` |
| Canton | Canton connector | `contractEvents` |

See chain samples under [`samples/`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/) for stream configuration examples.

### 5. Upgrading the provider

Build and promote a new image tag:

```bash
npm run package:docker   # or package:podman
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
npm run promote:docker   # or promote:podman, or promote:crane
```

Then update the running provider:

- **UI** — edit the Provider service / runtime and select the new artifact tag, or
- **API** — if your project includes `patch-provider-runtime`:

  ```bash
  # Requires platform URL and API credentials with permission to patch the runtime.
  export PLATFORM_URL=https://my-kaleido.io
  export ENV_ID=my-environment-id
  export API_KEY=my-api-key
  export API_SECRET=my-api-secret
  export RUNTIME_NAME=my-provider-runtime
  export IMAGE_REPOSITORY=my-namespace/my-provider
  npm run patch-provider-runtime
  ```

To change application settings, update `provider-config.yaml`, regenerate `provider-config.json`, and upload via the UI (or Terraform `file_sets` below).

For infrastructure-as-code, use the [Kaleido Terraform provider](https://github.com/kaleido-io/terraform-provider-kaleido):

```hcl
resource "kaleido_platform_runtime" "my_provider_runtime" {
  name        = "my-provider-runtime"
  type        = "Provider"
  environment = var.environment_id
  image = {
    repository = "my-namespace/my-provider"
    tag        = "v1"
  }
  config_json = jsonencode({})
}

resource "kaleido_platform_service" "my_provider_service" {
  name        = "my-provider"
  type        = "Provider"
  environment = var.environment_id
  runtime     = kaleido_platform_runtime.my_provider_runtime.id
  config_json = jsonencode({
    configFileJSON = {
      fileRef = "#provider-config#config.json"
    }
  })

  file_sets = {
    provider_config = {
      name = "provider-config"
      files = {
        config.json = {
          type = "json"
          data = {
            text = file("config/provider-config.json")
          }
        }
      }
    }
  }
}
```

### Troubleshooting (hosted)

1. **New image tag not taking effect on the Provider runtime**
   - Ensure the tag was pushed successfully to the artifact registry.
   - Check Provider runtime logs for stop/restart during rollout.
   - Image updates may take up to a few minutes to take effect.

2. **Provider is not receiving events**
   - Confirm the stream targets the correct provider name and handler.
   - Confirm the Provider runtime is healthy and **Provider proxy** shows the provider connected.
   - Check workflow engine logs for your stream ID (polling and delivery to the event processor).
   - On the connector, verify chain connectivity; for large catch-up, try reducing `catchupPageSize` or `batchSize` in stream config.
   - Provider proxy Swagger: `PUT /providers/{name}/reconnect` to force a reconnect.

3. **Asset manager or downstream API errors**
   - Inspect Provider logs for auth or binding failures on bulk upsert calls.
   - Misconfigured streams may deliver events your event processor cannot map (wrong contract, party, or network).
   - Bulk upsert has per-request limits; reduce stream `batchSize` or use auto-flush thresholds in the event processor.

Detailed, chain-specific notes: [`samples/btc-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/btc-indexer), [`samples/erc20-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/erc20-indexer), [`samples/canton-cip56-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/canton-cip56-indexer), [`samples/native-eth-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/native-eth-indexer), [`samples/workflow-engine-provider`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/workflow-engine-provider).
