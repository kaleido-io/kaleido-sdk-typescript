# Kaleido Connector TypeScript SDK

TypeScript helpers and chain-specific types for Kaleido connectors (EVM, Bitcoin, Canton). Use this SDK from workflow engine providers — for example indexers — to idempotently create connector streams in `setup()` and to type-check event payloads in batch handlers.

This package is one of several Kaleido TypeScript SDK packages. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido Typsescript SDK Readme](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/README.md)

## What this SDK provides

- **`EVMConnectorClient`**, **`BTCConnectorClient`**, **`CantonConnectorClient`** — thin wrappers around stream setup for each connector binding
- **Stream configuration types** — `EVMTransactionEventsConfig`, `BTCTransactionEventsConfig`, `CantonContractEventsConfig`
- **Event payload types** — `EVMTransactionEvent`, `BTCTransactionEvent`, `CantonContractEvent`, and related decoded/struct types
- **BTC transaction building types** — `TransactionSpec` and related input/output specs (mirrors the connector's transaction-spec API)
- **CIP-56 helpers** — `HOLDING_INTERFACE`, `TRANSFER_INSTRUCTION_INTERFACE`, `HoldingView`, `TransferData`

**Dependency on `@kaleido-io/workflow-engine-sdk`:** This package depends on the workflow engine SDK. Stream setup delegates to `ensureStream` from `@kaleido-io/workflow-engine-sdk`, which requires a workflow engine `SetupContext` (provider name, handler name, service bindings). In practice you use the connector SDK together with `@kaleido-io/workflow-engine-sdk` — installing `@kaleido-io/connector-sdk` pulls in the workflow engine SDK as a transitive dependency.

Typical use cases:

- Indexer `setup()` hooks that create or update connector streams pointing at your handler
- Typed `indexBatch` handlers that process decoded connector events
- BTC transaction-spec payloads when building transactions via the connector

## Running hosted or non-hosted

Applications using the Connector SDK can run in one of 2 modes. Hosted or non-hosted.

Step-by-step instructions: **[Running locally](#running-locally)** (development) · **[Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform)** (production).

### Hosted

The application is built as a docker images which is uploaded to the Kaleido Artifact Registry. A provider service is created inside the Kaleido platform to instantiate an instance of the provider which runs as a Kaleido managed service.

In hosted mode the application has conenction and auth context information automatically provided to it by service-bindings.

This is the intended usage mode for running a provider in production. See [Hosting on the Kaleido platform](#hosting-on-the-kaleido-platform) for build, push, and deploy steps.

### Non-hosted

The application runs locally on your development workstation, either as a typescript application or as a dockerfile. Connection information is provided as configuration via non-hosted service bindings which contain connection information required to connect to Kaleido platform services.

Running in this mode is intended to allow you to iterate quickly during development of a provider. It is not reccomended to run in non-hosted mode for production use-cases. See [Running locally](#running-locally) for setup and verification steps.

## Quick start

### Scaffolding from a template

The `kaleido-sdk` pacakage allows you to scaffold a new or existing project from and example to get started quickly:

Scaffold a new provider project from a template:

```bash
# Start from the ERC-20 indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template erc20-indexer

# Start from the Bitcoin indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template btc-indexer

# Start from the native ETH indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template native-eth-indexer

# Start from the Canton CIP-56 indexer template
npx @kaleido-io/kaleido-sdk init <project-name> --template canton-cip56-indexer
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
| `Dockerfile` | Container build for running the provider/indexer in deployment environments. |
| `tsconfig.json` | TypeScript compiler settings for the scaffolded project. |
| `vitest.config.ts` | Test runner configuration included by templates that ship tests. |

### Installation

If you do not wish to start from a template you can simply import the SDK directly:

```bash
npm install @kaleido-io/connector-sdk
```

This installs `@kaleido-io/workflow-engine-sdk` as a transitive dependency (required for stream setup).

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

Connector clients resolve connectivity from named entries under `service-bindings`. You also need a `workflow-engine` stanza when running a provider (see the [Workflow Engine SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/packages/workflow-engine-sdk/README.md)); connector stream setup uses both the WFE connection and the connector binding.

```yaml
workflow-engine:
  providerName: my-indexer
  url: https://wfe.example.com
  auth:
    type: token
    token: ${WFE_TOKEN}
    scheme: Bearer

service-bindings:
  evm-connector:
    type: connector
    bindingType: non-hosted
    url: https://evm-connector.example.com
    auth:
      type: token
      token: ${CONNECTOR_TOKEN}
      scheme: Bearer

  # Hosted binding example (resolved via ws-proxy)
  evm-connector-hosted:
    type: connector
    bindingType: hosted
    id: svc-connector-001

  btc-connector:
    type: connector
    bindingType: non-hosted
    url: https://btc-connector.example.com
    auth:
      type: basic
      username: my-user
      password: my-api-key

  canton-connector:
    type: connector
    bindingType: hosted
    id: svc-canton-001
```

### Service bindings

A service binding provides a mapping between the name of a service and it's conenction information. Because this is held in config this means that you can swap between hosted bindings where the connectivity information is autoamtically provided by the platform and non-hosted bindings where you provide the connection information.

This means that you can seaamlessly transition between running an application locally on your development workstation in order to iterate quickly and running hosted within the Kaleido platform.

When constructing a connector client you pass the binding name configured for your connector. Use `fromConfigFile()` to validate the binding exists in config:

```typescript
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import { BTCConnectorClient } from '@kaleido-io/connector-sdk/btc';
import { CantonConnectorClient } from '@kaleido-io/connector-sdk/canton';

const evm = EVMConnectorClient.fromConfigFile('evm-connector');
const btc = BTCConnectorClient.fromConfigFile('btc-connector');
const canton = CantonConnectorClient.fromConfigFile('canton-connector');
```

```yaml
service-bindings:
  evmMainnet:
    type: connector
    bindingType: non-hosted
    url: https://evm-mainnet.example.kaleido.cloud
    auth:
      type: token
      token: ${CONNECTOR_TOKEN}
      scheme: Bearer
  evmTestnet:
    type: connector
    bindingType: non-hosted
    url: https://evm-testnet.example.kaleido.cloud
    auth:
      type: token
      token: ${CONNECTOR_TOKEN}
      scheme: Bearer
```

**Example — non-hosted connector with token auth:**

```yaml
service-bindings:
  evm-connector:
    type: connector
    bindingType: non-hosted
    url: https://myaccount.myinstance.kaleido.io/endpoint/e:my-env/s:my-evm-connector/rest
    auth:
      type: token
      token: ${CONNECTOR_TOKEN}
      header: Authorization   # optional, defaults to Authorization
      scheme: Bearer          # optional, e.g. "Bearer" for "Bearer <token>"
```

When you are running in `hosted` mode the platform resolves connector connections via ws-proxy; the binding `id` is provided in config and connectivity details are injected at runtime.

Stream operations always run through `ensureStream(ctx, ...)` with a setup context from your provider runtime — the binding name selects which connector service to call.

### Provider config (`provider-config.yaml`)

This file is for your own application settings (stream names, filters, contract addresses, batch sizes, etc.), not platform connection details. When you are implementing an indexer the configuration is automatically made available for you as `ctx.config`. For example:

```yaml
contractAddress: '0x0000000000000000000000000000000000000001'
contractName: MyToken
stream:
  connectorBindingName: evm-connector
  factory: evmTransactions
  name: my-erc20-stream
  description: ERC-20 Transfer events
  eventSourceConfig:
    fromBlock: latest
    batchSize: 50
    logFilters:
      - addresses:
          - '0x0000000000000000000000000000000000000001'
        eventSignatures:
          - Transfer(address,address,uint256)
```

```ts
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import type { SetupContext } from '@kaleido-io/workflow-engine-sdk';

interface MyConfig {
  stream?: {
    connectorBindingName: string;
    factory: string;
    name: string;
    description?: string;
    eventSourceConfig: Record<string, unknown>;
  };
}

// Inside an indexer setup hook:
async setup(ctx: SetupContext<MyConfig>) {
  const { stream } = ctx.config;
  if (stream) {
    await new EVMConnectorClient(stream.connectorBindingName).ensureStream(ctx, {
      factory: stream.factory,
      name: stream.name,
      description: stream.description,
      eventSourceConfig: stream.eventSourceConfig,
    });
  }
}
```

### Environment Variables

By default configuration is sourced from the following environment variables:

- `KALEIDO_CONFIG_FILE` - path to `config.yaml` (preferred)
- `CONFIG_FILE` - path to `provider-config.yaml`

These paths are used to locate configuration when isntantiating new clients using the `fromConfigFile()` methods with no path argument. Using these environment variables means that you can inject configuration into a docker container at development time. When running hosted within the Kaleido platform the platform will write configuration information for service bindings in KALEIDO_CONFIG_FILE and will write the provided config file into CONFIG_FILE.

## Package entry points

Import from the root package or chain-specific subpaths:

| Import path | Exports |
|---|---|
| `@kaleido-io/connector-sdk` | All chain modules + logging re-exports |
| `@kaleido-io/connector-sdk/evm` | `EVMConnectorClient`, EVM types, `EVMTransactionEventsConfig` |
| `@kaleido-io/connector-sdk/btc` | `BTCConnectorClient`, BTC types, `BTCTransactionEventsConfig`, `TransactionSpec` |
| `@kaleido-io/connector-sdk/canton` | `CantonConnectorClient`, Canton types, CIP-56 constants |

## Connector clients

Each connector client wraps `ensureStream` from `@kaleido-io/workflow-engine-sdk` with a fixed binding name. Call `ensureStream` from an indexer or provider **`setup`** hook — not from standalone scripts without a WFE `SetupContext`.

### Construction

```typescript
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import { BTCConnectorClient } from '@kaleido-io/connector-sdk/btc';
import { CantonConnectorClient } from '@kaleido-io/connector-sdk/canton';

// Default binding name ('evm-connector', 'btc-connector', 'canton-connector')
const evm = new EVMConnectorClient();
const btc = new BTCConnectorClient('btc-mainnet');
const canton = new CantonConnectorClient('canton-connector');

// Validate binding exists in config.yaml
const evmFromConfig = EVMConnectorClient.fromConfigFile('evm-connector');
const btcFromConfig = BTCConnectorClient.fromConfigFile('btc-connector', '/path/to/config.yaml');
```

### `ensureStream(ctx, opts)`

Idempotently create or update a workflow engine stream on the connector. The stream wires the connector event source to your registered handler.

| Parameter | Description |
|---|---|
| `ctx` | `SetupContext` fields: `providerName`, `handlerName`, `getServiceClientOptions` |
| `opts.factory` | Stream factory on the connector (see table below) |
| `opts.name` | Unique stream name (idempotent upsert key) |
| `opts.eventSourceConfig` | Connector-specific filter/batch config |
| `opts.description` | Optional human-readable description |

**Common stream factories:**

| Chain | Factory | Typical use |
|---|---|---|
| EVM | `evmTransactions` | Contract logs / decoded events |
| EVM | `nativeEthTransactions` | Native ETH transfers (block trace) |
| BTC | `transactionEvents` | Bitcoin transaction batches |
| Canton | `contractEvents` | Daml contract create/archive/exercise events |

### EVM example

```typescript
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import type { EVMTransactionEventsConfig } from '@kaleido-io/connector-sdk/evm';

const evm = new EVMConnectorClient('evm-connector');

const eventSourceConfig: EVMTransactionEventsConfig = {
  fromBlock: 'latest',
  batchSize: 100,
  batchTimeout: '5s',
  requiredConfirmations: 12,
  logFilters: [
    {
      addresses: ['0xContractAddress...'],
      eventSignatures: ['Transfer(address,address,uint256)'],
    },
  ],
};

await evm.ensureStream(ctx, {
  factory: 'evmTransactions',
  name: 'erc20-transfers',
  description: 'ERC-20 Transfer indexing',
  eventSourceConfig,
});
```

### BTC example

```typescript
import { BTCConnectorClient } from '@kaleido-io/connector-sdk/btc';

await new BTCConnectorClient('btc-connector').ensureStream(ctx, {
  factory: 'transactionEvents',
  name: 'btc-mainnet',
  eventSourceConfig: {
    fromBlock: 'latest',
    batchSize: 50,
    requiredConfirmations: 6,
  },
});
```

### Canton example

```typescript
import {
  CantonConnectorClient,
  HOLDING_INTERFACE,
} from '@kaleido-io/connector-sdk/canton';

await new CantonConnectorClient('canton-connector').ensureStream(ctx, {
  factory: 'contractEvents',
  name: 'cip56-holdings',
  eventSourceConfig: {
    fromCurrentOffset: true,
    filters: {
      parties: ['party::123...'],
      interfaceIds: [HOLDING_INTERFACE],
    },
    stream: {
      batchSize: 100,
      pollTimeout: '5s',
    },
  },
});
```

For the low-level `ensureStream` API (without chain client wrappers), see `@kaleido-io/workflow-engine-sdk`.

## Stream configuration types

### `EVMTransactionEventsConfig`

Configuration for EVM connector stream factories (`evmTransactions`, `nativeEthTransactions`). Key fields:

| Field | Description |
|---|---|
| `abi` | ABI JSON for decoding logs, inputs, and errors |
| `fromBlock` | `'latest'`, `'earliest'`, or block number string |
| `batchSize` / `batchTimeout` / `pollTimeout` | Batch delivery tuning |
| `requiredConfirmations` | Block confirmations before delivery |
| `logFilters` | Address + event signature filters (OR-combined) |
| `unfiltered` | Must be `true` when no filters are set |
| `enableBlockTrace` | Capture native ETH transfers via trace |
| `eventMode` | `'all'`, `'require_decoded'`, or `'filter_decoded'` |
| `catchupPageSize` / `catchupBlockFetchAhead` | Catch-up performance |
| `includeInputs` / `includeBinaryInput` / `includeBinaryLogs` | Payload shape controls |

Also exported: `EVMLogFilter`.

### `BTCTransactionEventsConfig`

Configuration for the BTC `transactionEvents` factory. Key fields: `fromBlock`, `batchSize`, `batchTimeout`, `pollTimeout`, `requiredConfirmations`, `unfiltered`, `catchupPageSize`, `batchUTXOSoftLimit`.

### `CantonContractEventsConfig`

Configuration for the Canton `contractEvents` factory:

| Field | Description |
|---|---|
| `fromOffset` / `fromCurrentOffset` | Starting ledger position |
| `includeCreatedEventBlob` | Include created-event blob in payloads |
| `userId` | Canton user id for the subscription |
| `filters.parties` | Parties to listen on |
| `filters.templateIds` | Template filters (`#Package:Module:Entity`) |
| `filters.interfaceIds` | Interface filters |
| `stream.batchSize` / `stream.pollTimeout` / `stream.channelBufferSize` | Delivery tuning |

Also exported: `CantonContractEventsFilters`, `CantonContractEventsStream`.

## Event and payload types

Use these types when implementing `indexBatch` handlers (`EventProcessorEvent<T>` from `@kaleido-io/workflow-engine-sdk`).

### EVM (`@kaleido-io/connector-sdk/evm`)

| Type | Description |
|---|---|
| `EVMTransactionEvent` | Top-level event delivered to your handler |
| `EVMBlockInfo` | Block metadata |
| `EVMTransaction` | Raw transaction fields |
| `EVMTransactionReceipt` | Receipt summary |
| `EVMDecodedLogEvent` | ABI-decoded log (`signature`, `address`, `data`) |
| `EVMDecodedError` / `EVMDecodedFunctionInput` | Decoded revert / input |
| `EVMNativeETHTransfer` | Native ETH transfer from block trace |

### BTC (`@kaleido-io/connector-sdk/btc`)

| Type | Description |
|---|---|
| `BTCTransactionEvent` | Top-level event (`network`, `block`, `tx`) |
| `TxSummary` | Transaction with `vin` / `vout` |
| `TxSummaryVIn` / `TxSummaryVOut` | Inputs and outputs |
| `BlockIdentity` | Block height and hash |
| `NetworkInfo` | Network name and magic |

### Canton (`@kaleido-io/connector-sdk/canton`)

| Type | Description |
|---|---|
| `CantonContractEvent` | Created / archived / exercised event |
| `ContractInterfaceView` | Interface view on a contract event |
| `HoldingView` / `TransferData` | CIP-56 decoded view shapes |
| `HOLDING_INTERFACE` / `TRANSFER_INSTRUCTION_INTERFACE` | Well-known interface id strings |

## BTC transaction specification types

The BTC module exports types for building precise Bitcoin transactions via the connector (mirrors the connector's Go `btctypes` package):

| Type | Description |
|---|---|
| `TransactionSpec` | Full transaction: `inputs`, `outputs`, optional `availableKeys`, `lockTime` |
| `InputSpec` | Spend a UTXO (`txid`, `vout`, `scriptPubKey`, signing hints) |
| `OutputSpec` | Create an output (`valueSat`, `scriptType`, `spenders`, …) |
| `OutPointSpec` | UTXO outpoint reference |
| `AvailableKey` | Key material for auto-matching signers |
| `ScriptType` | Bitcoin script type strings (`p2pkh`, `p2wpkh`, `p2tr`, …) |
| `SignatureHashType` | Sighash flags (`all`, `none`, `single`, …) |

## Using with workflow engine indexers

Indexers register on `WorkflowEngineClient` and receive connector events in `indexBatch`. Typical flow:

1. **`setup(ctx)`** — call `connectorClient.ensureStream(ctx, …)` to create the stream; optionally bootstrap Asset Manager state
2. **`indexBatch(ctx, events)`** — process typed events (often bulk-upserting into Asset Manager)

```typescript
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';
import { EVMConnectorClient } from '@kaleido-io/connector-sdk/evm';
import type { EVMTransactionEvent } from '@kaleido-io/connector-sdk/evm';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

interface MyConfig {
  stream: { connectorBindingName: string; factory: string; name: string; eventSourceConfig: object };
}

class MyIndexer {
  async setup(ctx) {
    const { stream } = ctx.config as MyConfig;
    await new EVMConnectorClient(stream.connectorBindingName).ensureStream(ctx, {
      factory: stream.factory,
      name: stream.name,
      eventSourceConfig: stream.eventSourceConfig,
    });
  }

  async indexBatch(ctx, events: { data: EVMTransactionEvent }[]) {
    const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder();
    for (const { data } of events) {
      // map data.decodedEvents, data.ethTransfers, etc.
    }
    await builder.execute();
  }
}

WorkflowEngineClient.fromConfigFile<MyConfig>()
  .indexer('my-indexer', new MyIndexer())
  .start();
```

See the [Workflow Engine SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/packages/workflow-engine-sdk/README.md) for indexer registration, and the [Asset Manager SDK README](https://github.com/kaleido-io/kaleido-sdk-typescript/blob/main/packages/asset-manager-sdk/README.md) for bulk upsert patterns.

## Logging

Structured logging is re-exported from `@kaleido-io/workflow-engine-sdk` (same implementation as other Kaleido SDKs):

```typescript
import { newLogger, setLoggerFactory } from '@kaleido-io/connector-sdk';

const log = newLogger('my-indexer');
log.info('Ensuring EVM stream', { name: 'erc20-transfers' });
```

## Samples

Relevant samples in this repository:

| Sample | Chain | Demonstrates |
|---|---|---|
| [`samples/erc20-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/erc20-indexer) | EVM | `EVMConnectorClient`, ERC-20 log filters, Asset Manager upsert |
| [`samples/native-eth-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/native-eth-indexer) | EVM | `nativeEthTransactions` factory, ETH transfers |
| [`samples/btc-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/btc-indexer) | BTC | `BTCConnectorClient`, UTXO/event mapping |
| [`samples/canton-cip56-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/canton-cip56-indexer) | Canton | `CantonConnectorClient`, CIP-56 interface views |

See [Quick start](#quick-start) for scaffolding an indexer project from a template.

## Deploying and running providers

Detailed runbooks for the two modes in [Running hosted or non-hosted](#running-hosted-or-non-hosted). Configure bindings and app settings first via the [Configuration Model](#configuration-model).

## Running locally

Use **non-hosted** mode to develop a provider on your workstation. Your process connects **outbound** to the workflow engine and to any **non-hosted** service bindings in `config.yaml`. Kaleido does not run the provider binary for you in this mode.

This flow applies to providers built with `@kaleido-io/workflow-engine-sdk` (transaction handlers, event sources, event processors, and indexers). Indexers often also use `@kaleido-io/asset-manager-sdk` and `@kaleido-io/connector-sdk`; the same local run steps apply.

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
- **Indexers:** if `provider-config.yaml` defines a `stream` block, confirm `setup()` creates the connector stream on first run (check connector UI or logs).
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

### 4. Streaming events to the provider (indexers)

Indexers typically call `ensureStream` in `setup()` using the `stream` block in `provider-config.yaml` (via `@kaleido-io/connector-sdk`). On first startup the stream is created or updated to deliver batches to your registered handler.

Event path: **connector** → workflow engine **stream** → your **indexer** `indexBatch` handler → (often) **Asset manager** bulk upsert.

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
   - Misconfigured streams may deliver events your indexer cannot map (wrong contract, party, or network).
   - Bulk upsert has per-request limits; reduce stream `batchSize` or use auto-flush thresholds in the indexer.

Detailed, chain-specific notes: [`samples/btc-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/btc-indexer), [`samples/erc20-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/erc20-indexer), [`samples/canton-cip56-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/canton-cip56-indexer), [`samples/native-eth-indexer`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/native-eth-indexer), [`samples/workflow-engine-provider`](https://github.com/kaleido-io/kaleido-sdk-typescript/tree/main/samples/workflow-engine-provider).

## License

Apache-2.0
