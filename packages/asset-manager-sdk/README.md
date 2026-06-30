# Kaleido Asset Manager TypeScript SDK

A TypeScript client for the Kaleido Asset Manager service. Use it to read and write the Asset Manager data model — assets, addresses, transfers and more — from standalone applications or from workflow engine indexers. More information on digital assets is available in the [Kaleido platform docsite](https://docs.kaleido.io/platform/digital-assets/overview)

This package is one of several Kaleido TypeScript SDK packages. For details of other SDK packages or general information about Kaleido SDKs see the [Kaleido Typsescript SDK Readme](../../README.md) 

## What this SDK provides

- **`AssetManagerClient`** — typed REST client for every Asset Manager API surface
- **`bulkQuery` / `bulkUpsert`** — multi-collection read and write in a single request
- **`BulkUpsertBuilder`** — accumulate updates safely (deduplication, dependency retry, auto-flush) before calling bulk upsert


Typical use cases:

- Standalone scripts and services that push or query tokenized asset data
- Running in an application server that hosts a custom applicaiton that runs against the Kaleido Asset manager data model.
- Indexers (built with `@kaleido-io/workflow-engine-sdk`) that ingest chain events into the Asset Manager data model

## Running hosted or non-hosted

Applications using the Asset Manager SDK can run in one of 2 modes. Hosted or non-hosted.

### Hosted

The application is built as a docker images which is uploaded to the Kaleido Artifact Registry. A provider service is created inside the Kaleido platform to instantiate an instance of the provider which runs as a Kaleido managed service.

In hosted mode the application has conenction and auth context information automatically provided to it by service-bindings.

This is the intended usage mode for running a provider in production.

### Non-hosted

The application runs locally on your development workstation, either as a typescript application or as a dockerfile. Connection information is provided as configuration via non-hosted service bindings which contain connection information required to connect to Kaleido platform services.

Running in this mode is intended to allow you to iterate quickly during development of a provider. It is not reccomended to run in non-hosted mode for production use-cases.

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
| `Dockerfile` | Container build for running the provider/indexer in deployment environments. |
| `tsconfig.json` | TypeScript compiler settings for the scaffolded project. |
| `vitest.config.ts` | Test runner configuration included by templates that ship tests. |

### Installation

If you do not wish to start from a template you can simply import the SDK directly

```bash
npm install @kaleido-io/asset-manager-sdk
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
  asset-manager-hosted:
    type: asset-manager
    bindingType: hosted
    id: svc-am-001
```

### Service bindings

A service binding provides a mapping between the name of a service and it's conenction information. Because this is held in config this means that you can swap between hosted bindings where the connectivity information is autoamtically provided by the platform and non-hosted bindings where you provide the connection information.

This means that you can seaamlessly transition between running an application locally on your development workstation in order to iterate quickly and running hosted within the Kaleido platform.

When constructing a client you can specify the name of a service binding in order to have the client configured with the appropriate connection for that service. For example:

```typescript
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

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

**Example — non-hosted with basic auth:**

```yaml
service-bindings:
  asset-manager:
    type: asset-manager
    bindingType: non-hosted
    url: https://myaccount.myinstance.kaleido.io/endpoint/e:my-env/s:my-asset-manager/rest
    auth:
      type: basic
      username: my-user
      password: my-api-key
```

**Example — non-hosted with token auth:**

```yaml
service-bindings:
  asset-manager:
    type: asset-manager
    bindingType: non-hosted
    url: https://am.example.com/api/v1
    auth:
      type: token
      token: ${AM_TOKEN}
      header: Authorization   # optional, defaults to Authorization
      scheme: Bearer          # optional, e.g. "Bearer" for "Bearer <token>"
```

When you are running in `hosted` mode the platform resolves the Asset Manager connection via ws-proxy; the binding `id` is provided in config and connectivity details are injected at runtime.

### Provider config (`provider-config.yaml`)

This file is for your own application settings (batch size, contract addresses, upsert thresholds, etc.), not platform connection details. When you are implementing an indexer the configuration is automatically made available for you as `ctx.config`. For example:

```yaml
upsertTriggerCount: 100
contractAddress: '0x0000000000000000000000000000000000000001'
contractName: MyToken
```

```ts
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

interface MyConfig {
  upsertTriggerCount: number;
  contractAddress: string;
  contractName: string;
}

// Inside an indexer indexBatch handler (ctx from @kaleido-io/workflow-engine-sdk):
async indexBatch(ctx, events) {
  const { upsertTriggerCount } = ctx.config as MyConfig;
  const builder = new AssetManagerClient(ctx)
    .getNewBulkUpsertBuilder()
    .autoFlush(upsertTriggerCount);
  // ...
}
```

Standalone applications that only use the Asset Manager SDK can read their own settings from `provider-config.yaml` (or any config file) and pass explicit `ServiceClientOptions` to `AssetManagerClient` — see the [bulk-upsert sample](../../samples/bulk-upsert-sample).

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

## AssetManagerClient

### Construction

You can obtain an asset manager client in one of the following ways:

```typescript
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

// From a named service binding in config.yaml
const am = new AssetManagerClient('asset-manager');

// From config file 
const am2 = AssetManagerClient.fromConfigFile('asset-manager');

// From an explicitly named config file
const am3 = AssetManagerClient.fromConfigFile('asset-manager', '/path/to/config.yaml');

// From a workflow engine SetupContext (indexer setup / batch handlers)
// Resolves the binding via ctx.getServiceClientOptions('asset-manager')
const amFromCtx = new AssetManagerClient(ctx);
const amAltBinding = new AssetManagerClient(ctx, 'asset-manager-2');

// From explicit ServiceClientOptions (low-level)
const amExplicit = new AssetManagerClient({
  transport: 'http',
  url: 'https://myaccount.kaleido.io/.../rest',
  auth: { type: 'basic', username: 'user', password: 'api-key' },
});
```

When constructed from a `SetupContext`, `getNewBulkUpsertBuilder()` automatically wires `ctx.signal` so in-flight upserts cancel if the batch is aborted.

### Status

| Method | Description |
|---|---|
| `getStatus()` | Service health / status |

## Data model REST API

All methods below are on `AssetManagerClient`. List methods accept optional `filter` (and `label` where noted). Single-resource methods accept a name or id.

### Assets, addresses, pools, collections, activities

| Resource | List | Get | Create | Update | Delete |
|---|---|---|---|---|---|
| Assets | `getAssets` | `getAsset` | `createAsset` | `updateAsset` | `deleteAsset` |
| Addresses | `getAddresses` | `getAddress` | `createAddress` | `updateAddress` | `deleteAddress` |
| Pools | `getPools` | `getPool` | `createPool` | `updatePool` | `deletePool` |
| Collections | `getCollections` | `getCollection` | `createCollection` | `updateCollection` | `deleteCollection` |
| Activities | `getActivities` | `getActivity` | `createActivity` | `updateActivity` | `deleteActivity` |

### Data, events, fragments, NFTs, transfers

| Resource | List | Get | Create | Update | Delete |
|---|---|---|---|---|---|
| Data | `getData` | `getDataSingle` | `createData` | `updateData` | `deleteData` |
| Events | `getEvents` | `getEvent` | `createEvent` | `updateEvent` | `deleteEvent` |
| Fragments | `getFragments` | `getFragment` | `createFragment` | `updateFragment` | `deleteFragment` |
| NFTs | `getNFTs` | `getNFT` | `createNFT` | `updateNFT` | `deleteNFT` |
| Transfers | `getTransfers` | `getTransfer` | `createTransfer` | `updateTransfer` | `deleteTransfer` |

### Balances

| Method | Description |
|---|---|
| `getBalances` | List balances (optional filter) |
| `getBalance` | Get a balance by name or id |
| `getAddressBalances` | Balances for an address |
| `getAssetBalances` | Balances for an asset |
| `getPoolBalances` | Balances for a pool |

## Bulk query and bulk upsert

For high-throughput read/write across multiple collections, use the bulk endpoints directly on the client:

```typescript
import type { BulkQueryInput, BulkUpsertInput } from '@kaleido-io/asset-manager-sdk';

const queryResult = await am.bulkQuery({
  assets: { filter: { equal: [{ field: 'name', value: 'my-asset' }] } },
  transfers: { limit: 50 },
} satisfies BulkQueryInput);

await am.bulkUpsert({
  assets: [{ name: 'my-asset', updateType: 'create_or_ignore' }],
  addresses: [{ address: '0xabc...', updateType: 'create_or_update' }],
} satisfies BulkUpsertInput);
```

**Bulk query** returns filtered pages from any combination of: assets, activities, addresses, collections, data, events, fragments, nfts, pools, transfers, and balance changes.

**Bulk upsert** accepts the same entity types in `BulkUpsertInput`. Each item supports `updateType` (`create_or_ignore`, `create_or_update`, `update_only`, etc.) and optional labels.

## BulkUpsertBuilder

For indexer-style batching, prefer `BulkUpsertBuilder` over hand-rolling `BulkUpsertInput`. The builder:

- Ensures each record appears at most once per `execute()` call
- Deduplicates by entity key with configurable `DuplicateStrategy` (`MERGE`, `SKIP`, `REPLACE`)
- Retries invalid-reference errors (`KA090801`) item-by-item by default
- Supports post-upsert finalizers and optional auto-flush at a threshold

```typescript
import {
  AssetManagerClient,
  BulkUpsertBuilder,
  BulkUpsertInvalidRefError,
  DuplicateStrategy,
} from '@kaleido-io/asset-manager-sdk';

const am = new AssetManagerClient('asset-manager');

// Fresh builder per batch — use inside indexBatch handlers
const builder = am.getNewBulkUpsertBuilder();

builder
  .upsertAsset({ name: 'USDC', updateType: 'create_or_ignore' })
  .upsertAddress({ address: '0xfrom...', updateType: 'create_or_update' }, DuplicateStrategy.MERGE)
  .upsertTransfer({ /* ... */ })
  .addFinalizer(() => console.log('upsert committed'));

await builder.execute();
```

### Builder API

| Method | Description |
|---|---|
| `getNewBulkUpsertBuilder(options?)` | Create a builder wired to this client |
| `upsertActivity` / `upsertAddress` / `upsertAsset` / `upsertCollection` / `upsertData` / `upsertEvent` / `upsertFragment` / `upsertNFT` / `upsertPool` / `upsertTransfer` | Accumulate an update (chainable) |
| `addFinalizer(fn)` | Run after successful `execute()` |
| `hasUpdates()` | Whether the builder has pending items |
| `getCount()` | Number of accumulated items |
| `execute()` | Send bulk upsert and reset the builder |
| `autoFlush(n)` | Return a wrapper that calls `execute()` every `n` items |

**Options (`BulkUpsertBuilderOptions`):**

| Option | Default | Description |
|---|---|---|
| `signal` | — | Abort in-flight HTTP requests (auto-set from `SetupContext`) |
| `retryOnInvalidRef` | `true` | Retry `KA090801` individually; throws `BulkUpsertInvalidRefError` if stuck |

```typescript
// Disable dependency retry for fast failure
const strict = am.getNewBulkUpsertBuilder({ retryOnInvalidRef: false });

try {
  await strict.upsertPool({ name: 'pool-1', asset: 'missing-asset' }).execute();
} catch (err) {
  if (err instanceof BulkUpsertInvalidRefError) {
    console.error('Stuck items:', err.stuck);
  }
}
```

**Auto-flush** (common in indexers processing large batches):

```typescript
const flush = am.getNewBulkUpsertBuilder().autoFlush(100);

for (const event of events) {
  await flush.upsertTransfer(/* ... */); // executes every 100 items
}
await flush.execute(); // flush remainder
```

## Policies and tasks

Asset Manager policies and tasks are versioned resources with invoke endpoints.

### Policies

| Method | Description |
|---|---|
| `getPolicies` | List policies |
| `getPolicy` | Get policy (optional `withActive`) |
| `replacePolicy` | Replace policy document |
| `updatePolicy` | Patch policy metadata |
| `deletePolicy` | Delete policy |
| `invokePolicy` | Invoke active policy version |
| `invokeInlinePolicy` | Invoke without persisting a policy |
| `getPolicyVersions` / `getPolicyVersion` | List / get versions |
| `createPolicyVersion` / `updatePolicyVersion` / `deletePolicyVersion` | Manage versions |
| `invokePolicyVersion` | Invoke a specific version |

### Tasks

| Method | Description |
|---|---|
| `getTasks` | List tasks |
| `getTask` | Get task (optional `withActive`) |
| `replaceTask` / `updateTask` / `deleteTask` | CRUD |
| `invokeTask` / `invokeInlineTask` | Run task |
| `getTaskVersions` / `getTaskVersion` | List / get versions |
| `createTaskVersion` / `updateTaskVersion` / `deleteTaskVersion` | Manage versions |
| `invokeTaskVersion` | Invoke a specific version |

### Invocations and steps catalog

| Method | Description |
|---|---|
| `getInvocations` / `getInvocation` | List / get invocations |
| `deleteInvocation` | Delete invocation |
| `invocationFail` | Mark invocation failed |
| `invocationReplay` | Replay invocation |
| `invocationSuspend` / `invocationResume` | Suspend / resume |
| `getStepsCatalog` | Available policy/task step types |

## Subscriptions and listeners

### Data model subscriptions

| Method | Description |
|---|---|
| `getSubscriptions` / `getSubscription` | List / get |
| `replaceSubscription` | Replace subscription config |
| `deleteSubscription` | Delete |
| `subscriptionStart` / `subscriptionStop` | Start / stop |
| `subscriptionReset` | Reset with optional checkpoint |

### Data model listeners

| Method | Description |
|---|---|
| `getDataModelListeners` / `getDataModelListener` | List / get |
| `replaceDataModelListener` | Replace listener config |
| `deleteDataModelListener` | Delete |
| `dataModelListenerStart` / `dataModelListenerStop` | Start / stop |
| `dataModelListenerReset` | Reset with optional checkpoint |

### FireFly listeners

| Method | Description |
|---|---|
| `getFireFlyListeners` / `getFireFlyListener` | List / get |
| `replaceFireFlyListener` | Replace listener config |
| `deleteFireFlyListener` | Delete |
| `fireflyListenerStart` / `fireflyListenerStop` | Start / stop |

## Using with workflow engine indexers

Indexers receive a `SetupContext` in `setup()` and an `IndexerContext` in `indexBatch()`. Both expose `getServiceClientOptions()` and `signal`. Construct `AssetManagerClient` from the context — no separate binding config is needed in hosted mode:

```typescript
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import type { IndexerContext, SetupContext } from '@kaleido-io/workflow-engine-sdk';

class MyIndexer {
  async setup(ctx: SetupContext<MyConfig>) {
    const am = new AssetManagerClient(ctx);
    await am.createAsset({ name: 'bootstrap-asset' });
  }

  async indexBatch(ctx: IndexerContext<MyConfig>, events) {
    const builder = new AssetManagerClient(ctx).getNewBulkUpsertBuilder();
    for (const event of events) {
      builder.upsertTransfer(/* map event */);
    }
    await builder.execute();
  }
}
```

See `@kaleido-io/workflow-engine-sdk` for indexer registration and the [erc20-indexer sample](../../samples/erc20-indexer) for a full example.

## Exported types

The package re-exports typed request/response shapes for every data model entity and bulk operation. Import these for compile-time safety:

- **Common:** `ItemsResult`, `FilterResult`, `UpdateType`, `NameAndID`, …
- **Entities:** `Asset`, `Address`, `Pool`, `Activity`, `Collection`, `Data`, `Event`, `Fragment`, `NFT`, `Transfer`, `Balance`, …
- **Bulk:** `BulkQueryInput`, `BulkQueryOutput`, `BulkUpsertInput`, `BulkUpsertOutput`, `*BulkInput` per entity
- **Policies / tasks / invocations / subscriptions:** full type surface from `./interfaces`
- **Builder:** `BulkUpsertBuilderOptions`, `DuplicateStrategy`, `BulkUpsertInvalidRefError`, `IDataModelClient`, `IBulkQueryClient`, `IBulkUpsertClient`
- **Context:** `SetupContext`

## Logging

Structured logging is re-exported from this package (same implementation as other Kaleido SDKs):

```typescript
import { newLogger, setLoggerFactory } from '@kaleido-io/asset-manager-sdk';

const log = newLogger('my-am-app');
log.info('Starting bulk upsert', { count: 100 });
```

`AssetManagerClient` and `BulkUpsertBuilder` emit debug-level timing logs for bulk operations automatically.

## Samples

Relevant samples in this repository:

| Sample | Demonstrates |
|---|---|
| [`samples/bulk-upsert-sample`](../../samples/bulk-upsert-sample) | Standalone `BulkUpsertBuilder`, finalizers, `bulkQuery` |
| [`samples/dependency-ordering-sample`](../../samples/dependency-ordering-sample) | `retryOnInvalidRef` and `BulkUpsertInvalidRefError` |
| [`samples/erc20-indexer`](../../samples/erc20-indexer) | Indexer + `AssetManagerClient(ctx)` + bulk upsert |
| [`samples/btc-indexer`](../../samples/btc-indexer) | BTC indexer with auto-flush |
| [`samples/native-eth-indexer`](../../samples/native-eth-indexer) | Native ETH transfers |
| [`samples/canton-cip56-indexer`](../../samples/canton-cip56-indexer) | Canton holdings → Asset Manager |

See [Quick start](#quick-start) for scaffolding an indexer project from a template.

## License

Apache-2.0
