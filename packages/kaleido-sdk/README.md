# Kaleido SDK

The `@kaleido-io/kaleido-sdk` package is Kaleido's optional single entry point for TypeScript applications that use multiple platform services. It provides:

- **`KaleidoClient`** — a single facade over the workflow engine, asset manager, and connector SDKs
- **Project scaffolding** — `npx @kaleido-io/kaleido-sdk init` to bootstrap provider and indexer projects from templates
- **Shared exports** — logging helpers and `SetupContext` re-exports for multi-service apps

Installing this package pulls in all service SDK packages as transitive dependencies. If you only need one service, depend on that package directly instead — see [Using a single service SDK](#using-a-single-service-sdk).

For the full monorepo overview and links to every package, see the [Kaleido TypeScript SDK README](../../README.md).

## Packages

- [`@kaleido-io/workflow-engine-sdk`](../workflow-engine-sdk/README.md) — Workflow engine SDK; build hosted applications such as event sources, transaction handlers, event processors, and indexers
- [`@kaleido-io/asset-manager-sdk`](../asset-manager-sdk/README.md) — Asset manager SDK; bulk query and upsert into the asset model
- [`@kaleido-io/connector-sdk`](../connector-sdk/README.md) — Connector helpers and chain-specific types (EVM, BTC, Canton)
- [`@kaleido-io/kaleido-sdk`](./README.md) — This package (`KaleidoClient`) and the `init` scaffolding CLI

`@kaleido-io/core` is shared internal infrastructure (HTTP transport, logging, service-binding helpers) bundled into the public SDK packages. Application code should import logging and clients from a public SDK package, not from `@kaleido-io/core` directly.

## Using a single service SDK

You are able to use a single service SDK directly in order to avoid pulling in unnecesary dependencies.

For example, if your app is primarily a Workflow Engine provider, start with `@kaleido-io/workflow-engine-sdk`:

```ts
import { WorkflowEngineClient } from '@kaleido-io/workflow-engine-sdk';

const client = WorkflowEngineClient.fromConfigFile();
await client.connect();
```

See the package READMEs linked at the bottom of this document for service-specific APIs and examples.

## Using the KaleidoClient entry point

If your app spans multiple services and you want one facade, use `KaleidoClient`:

```ts
import { KaleidoClient } from '@kaleido-io/kaleido-sdk';

const client = KaleidoClient.fromConfigFile();
const wfe = client.workflowEngineClient();
const am = client.assetManagerClient();
const evm = client.evmConnectorClient();

await client.connect();
```

Note that adding `@kaleido-io/kaleido-sdk` as a dependncy pulls in all SDK packages as transitive dependencies.

### KaleidoClient API

| Method | Description |
|---|---|
| `KaleidoClient.fromConfigFile(path?)` | Load config from `KALEIDO_CONFIG_FILE` (or explicit path) |
| `new KaleidoClient({ workflowEngine?, serviceBindings? })` | Construct from explicit config |
| `workflowEngineClient()` | Primary workflow engine connection (provider runtime) |
| `assetManagerClient(bindingName?)` | Asset Manager client (default binding: `asset-manager`) |
| `evmConnectorClient(bindingName?)` | EVM connector helper (default: `evm-connector`) |
| `btcConnectorClient(bindingName?)` | BTC connector helper (default: `btc-connector`) |
| `cantonConnectorClient(bindingName?)` | Canton connector helper (default: `canton-connector`) |
| `connect()` / `disconnect()` | Connect or disconnect the primary workflow engine client |
| `getServiceBindings()` | Snapshot of configured service bindings |

Hosted service bindings require a connected workflow engine client (call `connect()` first). Non-hosted bindings resolve to direct HTTP and work without a workflow engine connection.

Explicit config without a config file:

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

Also exported from this package: `KaleidoClientConfig`, `SetupContext`, `createSetupContext`, and logging helpers (`newLogger`, `setLoggerFactory`, …).

For workflow engine handlers, asset manager REST APIs, connector stream setup, and chain-specific types, see the individual package READMEs rather than duplicating those examples here.

## Quick Start: Scaffold a Project

Install the package (globally optional — `npx` works without a prior install):

```bash
npm install @kaleido-io/kaleido-sdk
```

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

Omit `--template` in an interactive terminal and you'll be prompted to choose one.

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

`KaleidoClient.fromConfigFile()` loads both the `workflow-engine` section and `service-bindings` from this file.

### Service bindings

A service binding provides a mapping between the name of a service and it's conenction information. Because this is held in config this means that you can swap between hosted bindings where the connectivity information is autoamtically provided by the platform and non-hosted bindings where you provide the connection information.

This means that you can seaamlessly transition between running an application locally on your development workstation in order to iterate quickly and running hosted within the Kaleido platform.

When constructing a client you can specify the name of a service binding in order to have the client configured with the appropriate connection for that service. For example:

```typescript
import { KaleidoClient } from '@kaleido-io/kaleido-sdk';

const client = KaleidoClient.fromConfigFile();
const amClient1 = client.assetManagerClient('assetManager1');
const amClient2 = client.assetManagerClient('assetManager2');
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

The exception to this pattern is the connection to the Workflow engine itself. Since the workflow engine is a singleton you can not specify a binding name when obtaining a workflow engine client — use `client.workflowEngineClient()` with no binding argument. For more details see [Workflow Engine SDK docs](../workflow-engine-sdk/README.md).

### Provider config (`provider-config.yaml`)

This file is for your own application settings (batch size, allowlists, polling windows, etc.), not platform connection details.

### Environment Variables

By default configuration is sourced from the folloging environment variables:

- `KALEIDO_CONFIG_FILE` - path to `config.yaml` (preferred)
- `CONFIG_FILE` - path to `provider-config.yaml`

These paths are used to locate configuration when isntantiating new clients using the `fromConfigFile()` methods with no path argument. Using these environment variables means that you can inject configuration into a docker container at development time. When running hosted within the Kaleido platform the platform will write configuration information for service bindings in KALEIDO_CONFIG_FILE and will write the provided config file into CONFIG_FILE.

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
- **Transaction handlers:** submit a test workflow that invokes your handler (see [`samples/workflow-engine-provider`](../../samples/workflow-engine-provider)).

Working config examples per template: [`samples/`](../../samples/).

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

See chain samples under [`samples/`](../../samples/) for stream configuration examples.

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

Detailed, chain-specific notes: [`samples/btc-indexer`](../../samples/btc-indexer), [`samples/erc20-indexer`](../../samples/erc20-indexer), [`samples/canton-cip56-indexer`](../../samples/canton-cip56-indexer), [`samples/native-eth-indexer`](../../samples/native-eth-indexer), [`samples/workflow-engine-provider`](../../samples/workflow-engine-provider).

## Logging

All SDK packages share the same structured logger (implemented in `@kaleido-io/core` and re-exported by each public SDK). If you use multiple SDKs in one application, import logging from **one** package and use it consistently — `setLoggerFactory()` applies to that package's bundled logger.

When you use the single entry point, import from `@kaleido-io/kaleido-sdk`:

```ts
import { newLogger, setLoggerFactory } from '@kaleido-io/kaleido-sdk';

const log = newLogger('my-app');

log.info('Provider started', { providerName: 'my-indexer' });
log.debug('Processing batch', { count: 42 });
log.warn('Retrying request', { attempt: 2 });
log.error('Batch failed', { error: err.message });
```

To plug in your own backend (pino, winston, NestJS logger, etc.):

```ts
import { setLoggerFactory } from '@kaleido-io/kaleido-sdk';

setLoggerFactory((context) => ({
  debug: (msg, ...args) => myLogger.debug(`[${context}] ${msg}`, ...args),
  info: (msg, ...args) => myLogger.info(`[${context}] ${msg}`, ...args),
  warn: (msg, ...args) => myLogger.warn(`[${context}] ${msg}`, ...args),
  error: (msg, ...args) => myLogger.error(`[${context}] ${msg}`, ...args),
}));
```

If you depend on a single service SDK only, import `newLogger` and `setLoggerFactory` from that package instead — see each package README for its import path.

## Package Documentation

- [Kaleido TypeScript SDKs (monorepo)](../../README.md)
- [Workflow Engine SDK docs](../workflow-engine-sdk/README.md)
- [Asset Manager SDK docs](../asset-manager-sdk/README.md)
- [Connector SDK docs](../connector-sdk/README.md)

## License

Apache-2.0
