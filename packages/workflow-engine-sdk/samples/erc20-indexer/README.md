# erc20-indexer

A sample Kaleido Workflow Engine provider that indexes ERC-20 `Transfer` events
into the [Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `erc20-indexer`.
2. Registers an **event processor** (`indexer`) that receives decoded EVM
   transaction batches from an `evmTransactions`-compatible stream.
3. For every `Transfer(address,address,uint256)` log event, maps it to an Asset
   Manager `Transfer` with balance changes, then bulk-upserts addresses and
   transfers in a single API call.

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - An **EVM connector** stack connected to your EVM chain
  - An **ERC20 smart contract** deployed to your EVM chain
  - An **Asset manager** service

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure (edit both files)
cp config/wfe-config.yaml config/wfe-config.yaml      # already present
cp config/provider-config.yaml config/provider-config.yaml

# 3. Run in dev mode (no build step needed)
npm run start:dev

# 4. In a second terminal: create the event stream in the Workflow Engine
npm run create-stream
```

## Configuration

### `config/wfe-config.yaml`

Workflow Engine connection. `providerName` must match `src/provider.ts`.

### `config/provider-config.yaml`

| Key | Description |
|-----|-------------|
| `assetManager.account` | Your Kaleido account hostname |
| `assetManager.environment` | Environment ID |
| `assetManager.serviceName` | Asset Manager service ID |
| `assetManager.auth.keyName` | API key name |
| `assetManager.auth.keyValue` | API key value |
| `erc20.contractAddress` | ERC-20 contract address to index |
| `erc20.contractName` | Human-readable name (e.g. `USDC`) |
| `erc20.contractSymbol` | Token symbol |
| `erc20.chain` | Chain label attached to indexed data (e.g. `ethereum`) |
| `evmConnector` | Service ID of your EVM Connector provider |

## Customizing

This sample is yours to fork. Common customizations:

- **Multiple contracts** — create a second `ERC20Indexer` instance with a different
  config, add it to `HandlerSetFor(...)` in `connect.ts`, and create a second stream.
- **Custom event filtering** — edit `logFilters` in `src/erc20/stream.ts`.
- **Additional event types** — extend `eventProcessorBatch` in `src/erc20/indexer.ts`.

## Asset Manager client

`src/clients/asset-manager/` contains a lightweight REST client for the Asset Manager
bulk upsert API. This will be replaced by `@kaleido-io/asset-manager-sdk` once that
package is available. Until then, you own this code and can modify it freely.

## Hosting on the Kaleido platform

### Prerequisites

- In addition to the minimum prerequisites, you will need:
  - An **Artifact registry** service with an artifact **namespace** created
  - A **Provider proxy** service
  - To convert your `provider-config.yaml` to `provider-config.json`
    ```bash
    yq -o=json config/provider-config.yaml > config/provider-config.json
    ```

### Building an OCI image

```bash
npm install --save-dev @types/node
npm run package:docker # or package:podman for Podman users
```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform. You will need to ensure that your build environment is compatible with `linux/amd64` for building the image. Such as with MacOS on Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) on `linux/amd64`
for a minimal, shell-free runtime — required for hosting on the Kaleido platform.

### Pushing to the artifact registry

To push to your artifact registry:
```bash
# Set the image tag - must be unique as tags for each promote as tags are immutable
export IMAGE_TAG=v1alpha1-$(date +%Y%m%d%H%M%S)
# Set the artifact registry hostname
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
npm run promote:docker # or promote:podman for Podman users, or promote:crane if copying from an existing OCI registry via Crane
```

### Deploying the provider

1. Go to the Kaleido platform UI within your running environment
2. Navigate to the **Operations and resources** page
3. Click the **+** button on the **Services** section, to begin creating a new service
4. Select the **Provider** service type
5. After you have named your service:
  a. Refer to the namespace, `erc20-indexer` repository, and the promoted image tag for your provider
  b. Drag and drop the `config/provider-config.json` into the configuration file input box
6. Finish creating the **Provider** service
7. As the provider is provisioning, go to the underlying **Provider** runtime and view the **Logs** to ensure the provider is running correctly
8. Confirm you see the provider is connected within your **Provider proxy** service, and that it is registered within the **Workflow engine** service provider list

### Streaming events to the provider

You can then either use `npm run create-stream` to create a new stream pointed at your hosted provider, or go to your **EVM connector** service
and create a new stream pointed at your hosted provider via the `transactionEvents` stream factory and a copy of an ERC-20-compatible ABI.
