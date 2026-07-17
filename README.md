![Kaleido](./kaleido-logo.svg "Kaleido")

# Kaleido TypeScript SDKs

This repository contains Kaleido's TypeScript SDK packages for interacting with Kaleido platform
services. Using these SDK packages you can write standalone applications that connect to the
Kaleido platform, or hosted applications which run inside the Kaleido platform. Each SDK package
corresponds to a single Kaleido service, with an additional optional entry-point package for
applications which need to use many of the SDK packages.

## Packages

- [`@kaleido-io/core-sdk`](./packages/core-sdk/README.md) — Core utilities shared across all SDK packages: HTTP transport, logging, and service-binding resolution. Import logging from `@kaleido-io/core-sdk/log` and setup context from the package root.
- [`@kaleido-io/workflow-engine-sdk`](./packages/workflow-engine-sdk/README.md) — Workflow Engine SDK; allows you to build workflow engine hosted applications such as event sources, transaction handlers, event processors, and indexers
- [`@kaleido-io/asset-manager-sdk`](./packages/asset-manager-sdk/README.md) — Asset Manager SDK; allows you to interact with Kaleido's asset manager tokenization service to bulk query and upsert data into the asset model
- [`@kaleido-io/connector-sdk`](./packages/connector-sdk/README.md) — Connector SDK; provides connector helpers and chain-specific types (EVM, BTC, Canton)
- [`@kaleido-io/kaleido-sdk`](./packages/kaleido-sdk/README.md) — Optional umbrella package that serves as a single entry point for applications using multiple SDK packages (`KaleidoClient`) and provides the ability to scaffold projects based on templates via `npx @kaleido-io/kaleido-sdk init`

## Using a single service SDK

You are able to use a single service SDK directly in order to avoid pulling in unnecessary dependencies.

For example, if your app is primarily a Workflow Engine provider, start with `@kaleido-io/workflow-engine-sdk`:

```ts
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';

const client = WorkflowEngineClient.fromConfigFile();
await client.connect();
```

## Using the KaleidoClient entry point

If your app spans multiple services and you want one facade, you can use the `KaleidoClient` entry point:

```ts
import { KaleidoClient } from '@kaleido-io/kaleido-sdk';

const client = KaleidoClient.fromConfigFile();
const wfe = client.workflowEngineClient();
const am = client.assetManagerClient();
const evm = client.evmConnectorClient();
```

Note that adding `@kaleido-io/kaleido-sdk` as a dependency pulls in all SDK packages as transitive dependencies.

## Quick Start: Scaffold a Project

Create a project from a template:

```bash
# Workflow engine provider template
npx @kaleido-io/kaleido-sdk init my-provider --template workflow-engine-provider

# ERC-20 indexer template
npx @kaleido-io/kaleido-sdk init my-erc20-indexer --template erc20-indexer

# BTC indexer template
npx @kaleido-io/kaleido-sdk init my-btc-indexer --template btc-indexer

# Native ETH indexer template
npx @kaleido-io/kaleido-sdk init my-eth-indexer --template native-eth-indexer

# Canton CIP-56 indexer template
npx @kaleido-io/kaleido-sdk init my-canton-indexer --template canton-cip56-indexer
```

You can also add a template into an existing project (omit project name):

```bash
npx @kaleido-io/kaleido-sdk init --template erc20-indexer
```

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
| `Dockerfile` | Container build for running the provider/indexer in deployment environments. |
| `tsconfig.json` | TypeScript compiler settings for the scaffolded project. |
| `vitest.config.ts` | Test runner configuration included by templates that ship tests. |

## Samples in This Repository

- `samples/workflow-engine-provider`
- `samples/erc20-indexer`
- `samples/btc-indexer`
- `samples/native-eth-indexer`
- `samples/canton-cip56-indexer`
- `samples/bulk-upsert-sample`
- `samples/dependency-ordering-sample`

Each sample has a README with package-specific details.

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

A service binding provides a mapping between the name of a service and its connection information. Because this is held in config, you can swap between hosted bindings (where connectivity information is automatically provided by the platform) and non-hosted bindings (where you provide the connection information).

This means that you can seamlessly transition between running an application locally on your development workstation in order to iterate quickly and running hosted within the Kaleido platform.

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

The exception to this pattern is the Workflow Engine SDK. Since the workflow engine is a singleton, you cannot specify a binding name when obtaining a workflow engine client. For more details see [Workflow Engine SDK docs](./packages/workflow-engine-sdk/README.md).

### Provider config (`provider-config.yaml`)

This file is for your own application settings (batch size, allowlists, polling windows, etc.), not platform connection details.

### Environment Variables

By default configuration is sourced from the following environment variables:

- `KALEIDO_CONFIG_FILE` — path to `config.yaml` (preferred). Used by `fromConfigFile()` when no path argument is provided.
- `CONFIG_FILE` — path to `provider-config.yaml` (app-specific settings loaded by the Workflow Engine client)

Using these environment variables means that you can inject configuration into a Docker container at development time. When running hosted within the Kaleido platform, the platform writes service-binding configuration to `KALEIDO_CONFIG_FILE` and writes the provided config file into `CONFIG_FILE`.

## Logging

All SDK packages share the same structured logger from `@kaleido-io/core-sdk`. Import logging from `@kaleido-io/core-sdk/log` regardless of which service SDKs your application uses:

```ts
import { newLogger, setLoggerFactory } from '@kaleido-io/core-sdk/log';

const log = newLogger('my-app');

log.info('Provider started', { providerName: 'my-indexer' });
log.debug('Processing batch', { count: 42 });
log.warn('Retrying request', { attempt: 2 });
log.error('Batch failed', { error: err.message });
```

To plug in your own backend (pino, winston, NestJS logger, etc.):

```ts
import { setLoggerFactory } from '@kaleido-io/core-sdk/log';

setLoggerFactory((context) => ({
  debug: (msg, ...args) => myLogger.debug(`[${context}] ${msg}`, ...args),
  info: (msg, ...args) => myLogger.info(`[${context}] ${msg}`, ...args),
  warn: (msg, ...args) => myLogger.warn(`[${context}] ${msg}`, ...args),
  error: (msg, ...args) => myLogger.error(`[${context}] ${msg}`, ...args),
}));
```


## Example usage by package

### 1) Workflow Engine SDK (provider/runtime entry)

```ts
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';

const wfe = WorkflowEngineClient.fromConfigFile<MyProviderConfig>();
await wfe.connect();
```

### 2) Asset Manager SDK

`AssetManagerClient` supports multiple construction styles:

- from setup context (`new AssetManagerClient(ctx)`)
- from binding name in config (`new AssetManagerClient('asset-manager')`)
- from explicit service options (`new AssetManagerClient(opts)`)
- from binding + config file (`AssetManagerClient.fromConfigFile('asset-manager')`)

```ts
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

const am = new AssetManagerClient('asset-manager');
const status = await am.getStatus();

const amFromConfig = AssetManagerClient.fromConfigFile('asset-manager');
const status2 = await amFromConfig.getStatus();

const amFromExplicitServiceBinding = new AssetManagerClient({
    transport: 'http',
    url: 'https://myaccount.myinstance.kaleido.io/endpoint/e:my-env/s:my-asset-manager/rest',
    auth: {
      type: 'basic',
      username: 'myuser',
      password: 'my-api-key',
    },
  });
const status3 = await amFromExplicitServiceBinding.getStatus();
```

### 3) Connector SDK

Use connector helpers in setup flows. Pick the client for the chain you are indexing:

**EVM**

```ts
import { EVMConnectorClient } from '@kaleido-io/connector-sdk';

const evm = new EVMConnectorClient('evm-connector');
// inside setup: await evm.ensureStream(ctx, { factory, name, eventSourceConfig, ... });

const evmFromConfig = EVMConnectorClient.fromConfigFile('evm-connector');
```

**Bitcoin**

```ts
import { BTCConnectorClient } from '@kaleido-io/connector-sdk';

const btc = new BTCConnectorClient('btc-connector');
// inside setup: await btc.ensureStream(ctx, { factory, name, eventSourceConfig, ... });

const btcFromConfig = BTCConnectorClient.fromConfigFile('btc-connector');
```

**Canton**

```ts
import { CantonConnectorClient } from '@kaleido-io/connector-sdk';

const canton = new CantonConnectorClient('canton-connector');
// inside setup: await canton.ensureStream(ctx, { factory, name, eventSourceConfig, ... });

const cantonFromConfig = CantonConnectorClient.fromConfigFile('canton-connector');
```

`fromConfigFile()` validates that the requested binding exists in config.
Actual stream operations still run through `ensureStream(ctx, ...)` with a setup context from your provider runtime.

### 4) KaleidoClient (multi-service facade)

Good fit when one application intentionally uses multiple services and you want a single facade:

```ts
import { KaleidoClient } from '@kaleido-io/kaleido-sdk';

const client = KaleidoClient.fromConfigFile();
const am = client.assetManagerClient('asset-manager');
```

It is also possible to explicitly provide either hosted or non-hosted service bindings:

```ts
import { KaleidoClient } from '@kaleido-io/kaleido-sdk';

const client = new KaleidoClient({
  serviceBindings: {
    'asset-manager': {
      type: 'asset-manager',
      bindingType: 'non-hosted',
      url: 'https://am.example.com/api/v1',
      auth: { type: 'token', token: process.env.AM_TOKEN ?? '', scheme: 'Bearer' },
    },
  },
});

const am = client.assetManagerClient();
```

## Package Documentation

- [Core SDK docs](./packages/core-sdk/README.md)
- [Workflow Engine SDK docs](./packages/workflow-engine-sdk/README.md)
- [Asset Manager SDK docs](./packages/asset-manager-sdk/README.md)
- [Connector SDK docs](./packages/connector-sdk/README.md)
- [Kaleido SDK docs](./packages/kaleido-sdk/README.md)

## License

All packages in this monorepo are licensed under the Apache-2.0 License.
