# Kaleido Workflow Engine TypeScript SDK

A TypeScript SDK for building handlers that integrate with the Kaleido workflow engine. This is one of several SDK pacakges provided to interact with the Kaleido platform. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido Typsescript SDK Readme](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md) 

Using the Workflow engine SDK you can build applications called `providers` that interact with the workflow engine. The different types of providers supported are:

transaction handlers - Providers that execute workflow stage actions when the engine sends transaction batches (e.g. business logic, external API calls, stage transitions).
event sources - Providers that poll or subscribe to external systems and emit events (with checkpoints) into the workflow engine.
event processors - Providers that receive event batches from the engine and run your processing logic against them. Includes optional setup hooks, typed config, and service-binding helpers — suited for anything from simple event logging to ingesting events into a datastore.

More information on the workflow engine programming model is avalable from the [Kaleido platform docsite](https://docs.kaleido.io/platform/web3-middleware/workflowengine/)

## Running hosted or non-hosted

Providers built with the Workflow engine SDK can run in one of 2 modes. Hosted or non-hosted.

Step-by-step instructions: **[Running locally](#running-locally)** (development) · **[Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform)** (production).

### Hosted

The provider is built as a docker images which is uploaded to the Kaleido Artifact Registry. A provider service is created inside the Kaleido platform to instantiate an instance of the provider which runs as a Kaleido managed service.

In hosted mode the providers has conenction and auth context information automatically provided to it by service-bindings.

This is the intended usage mode for running a provider in production. See [Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform) for build, push, and deploy steps.

### Non-hosted

The provider runs locally on your development workstation, either as a typescript application or as a dockerfile. Connection information is provided as configuration via non-hosted service bindings which contain connection information required to connect to Kaleido platform services.

Running in this mode is intended to allow you to iterate quickly during development of a provider. It is not reccomended to run in non-hosted mode for production use-cases. See [Running locally](#running-locally) for setup and verification steps.


## Quick start

### Scaffolding from a template

The `kaleido-sdk` pacakage allows you to scaffold a new or existing project from and example to get started quickly:

Scaffold a new provider project from a template:

```bash
# Start from the workflow-engine-provider template
npx @kaleido-io/kaleido-sdk init <project-name> --template workflow-engine-provider

# Start from the ERC-20 indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template erc20-indexer

# Start from the Bitcoin indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template btc-indexer
```

Omit `--template` in an interactive terminal and you'll be prompted to choose one.

Scaffold a new provider project into an existing project:

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

If you do not wish to start from a template you can simply import the SDK directly

```bash
npm install @kaleido-io/workflow-engine-sdk
```

If you are using multiple SDK packaages you may wish to use the multi-service client:

```bash
npm install @kaleido-io/kaleido-sdk
```

Note that this will pull in all SDK pacakges as transitive dependncies.



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
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example.com/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer

  # Hosted binding example (resolved via ws-proxy)
  evm-connector:
    type: connector
    bindingType: hosted
    id: svc-connector-001
```

### Service bindings

A service binding provides a mapping between the name of a service and it's conenction information. Because this is held in config this means that you can swap between hosted bindings where the connectivity information is autoamtically provided by the platform and non-hosted bindings where you provide the connection information. 

This means that you can seaamlessly transition between running an application locally on your development workstation in order to iterate quickly and running hosted within the Kaleido platform.

When constructing a client you can specify the name of a service binding in order to have the client configured with the appropriate connection for that service. For example:

```typescript
const amClient1 = AssetManagerClient.fromConfigFile('assetManager1');
const amClient2 = AssetManagerClient.fromConfigFile('assetManager2');
```

```yaml
service-bindings:
  assetManager1:
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example.kaleido.cloud/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer
  assetManager2:
    type: asset-manager
    bindingType: non-hosted
    url: https://am2.example.kaleido.cloud/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer
```

The exception to this pattern is in the connection to the Workflow engine itself. The workflow engine is a singleton and this connection is also managed through the Provider Proxy running on the Kaleido platform, therefore this has it's own first-class stanza in the configuration file. The workflow engine connection is defined using the top level `workflow-engine` root-key in the config yaml file.

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

When you are running in `hosted` mode the platform instead uses a websocket connection to communicate with the workflow engine. The configuration for this web socket connection is automatically generated by a platform when you create a provider service.


### Provider config (`provider-config.yaml`)

This file is for your own application settings (batch size, allowlists, polling windows, etc.), not platform connection details. When you are implementing a provider the configuration is automatically made available for you as ctx.config. For example:

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

- `KALEIDO_CONFIG_FILE` - path to `config.yaml` (preferred)
- `CONFIG_FILE` - path to `provider-config.yaml`

These paths are used to locate configuration when isntantiating new clients using the `fromConfigFile()` methods with no path argument. Using these environment variables means that you can inject configuration into a docker container at development time. When running hosted within the Kaleido platform the platform will write configuration information for service bindings in KALEIDO_CONFIG_FILE and will write the provided config file into CONFIG_FILE.

## Core concepts

### WorkflowEngineClient

The main entry point that manages:

- Handler registration (transaction handlers and event sources)
- Connection lifecycle
- Automatic reconnection and re-registration
- Message routing between engine and handlers


Obtaining a client: 

Service bindings (reccomended)
```typescript
const client = WorkflowEngineClient.fromConfigFile();
```

Service bindings, non-default config file
```ts
const client = WorkflowEngineClient.fromConfigFile('/path/to/file.yaml');
```

Explicit service bindings
```typescript
const client = new WorkflowEngineClient({
  url: "ws://localhost:5503/ws",
  providerName: "my-service",
  authToken: "your-token",
  authHeaderName: "X-Kld-Authz", // Optional, defaults to X-Kld-Authz
  reconnectDelay: 2000, // Optional, ms between reconnect attempts
  maxAttempts: undefined, // Optional, undefined = infinite retries (recommended)
});
```

Usage
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

## Transaction handlers

Providers that execute workflow stage actions when the engine sends transaction batches.

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

### EngineAPI

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

### StageDirector pattern

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

## Event sources

Providers that poll or subscribe to external systems and emit events (with checkpoints) into the workflow engine.

Build the source with `createEventSource`, then register it on the client. Closures in the poll function are supported:

```typescript
import { WorkflowEngineClient, createEventSource } from '@kaleido-io/workflow-engine-sdk';

const myEventSource = createEventSource('my-event-source', async (config, checkpointIn) => ({
  checkpointOut: { lastId: (checkpointIn?.lastId ?? 0) + 1 },
  events: [{ idempotencyKey: 'evt-1', topic: 'my-topic', data: { value: 1 } }],
}));

WorkflowEngineClient.fromConfigFile()
  .eventSource(myEventSource)
  .start();
```

You can also pass a pre-built `EventSource` instance from a factory:

```typescript
WorkflowEngineClient.fromConfigFile()
  .eventSource(createTickerEventSource())
  .start();
```

## Event processors

Providers that receive event batches from the engine and run processing logic against them.

Use the fluent `.eventProcessor()` builder method. The batch function receives an `EventProcessorContext` with:

- `ctx.config` — typed access to your `provider-config.yaml`
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

Use `createEventProcessor` for the factory style (consistent with `createEventSource` / `createTransactionHandler`):

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

### Example: building an indexer with the Asset Manager SDK

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

## Logging

The SDK uses a structured logger:

```typescript
import { newLogger } from '@kaleido-io/workflow-engine-sdk';

const log = newLogger('my-component');

log.debug('Debug message', { metadata: 'value' });
log.info('Info message', { userId: 123 });
log.warn('Warning message', { reason: 'low memory' });
log.error('Error message', { error: err.message });
```

## Error handling

### Handler errors

Return appropriate `EvalResult` values from transaction handlers:

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

Event processors should throw from the batch function to mark a batch as failed; the SDK surfaces the error to the engine.

### Connection errors

The client automatically handles WebSocket disconnections, reconnection with backoff, handler re-registration on reconnect, and connection health monitoring.

```typescript
if (!client.isConnected) {
  console.warn('Client disconnected, will auto-reconnect');
}
```

## Complete transaction handler example

```typescript
import {
  WorkflowEngineClient,
  WorkflowEngineConfig,
  createTransactionHandler,
  InvocationMode,
  EvalResult,
  Patch,
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
              Patch.add("/validation", { valid: true, timestamp: new Date() }),
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

## Multiple handlers

A single application using the workflow engine SDK can register multiple handlers:

```typescript
// Register multiple handlers
client.registerTransactionHandler("handler1", handler1);
client.registerTransactionHandler("handler2", handler2);
client.registerEventSource("source1", source1);
client.registerEventSource("source2", source2);

// All handlers use the same WebSocket connection
await client.connect();
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
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example.com/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      scheme: Bearer

  evm-connector:
    type: connector
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
