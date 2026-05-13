# canton-cip56-indexer

A sample Kaleido Workflow Engine provider that indexes Canton CIP-56 token
holding and transfer events into the
[Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `canton-cip56-indexer`.
2. Registers an **event processor** that receives Canton contract events from a
   `cantonContractEvents`-compatible stream filtered on the CIP-56
   `HoldingV1` and `TransferInstructionV1` interface IDs.
3. Maps **Holding** creates/archives to Asset Manager fragments, transfers, and
   balance changes; maps **TransferInstruction** creates to pending-transfer
   fragments; and maps **TransferFactory** creates to pool definitions.

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - A **Canton connector** stack connected to your Canton network
  - A CIP-56 compliant token deployed on your Canton network
  - An **Asset manager** service

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Edit the config files
# Edit config/wfe-config.yaml — set providerName, url, and auth
# Edit config/provider-config.yaml — set assetManager and canton values
# See the Configuration section below for details on each field

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
| `canton.cantonConnector` | Service ID of your Canton Connector provider |

## Customizing

This sample is yours to fork. Common customizations:

- **Additional interface filters** — edit the `interfaceIds` in
  `src/canton/cip56/stream.ts` to subscribe to more Canton contract interfaces.
- **Custom handler logic** — extend the `handlers` array in
  `src/canton/cip56/indexer.ts` to process additional contract types.
- **Multiple indexers** — create additional indexer classes extending
  `BaseCantonIndexer` and register them alongside the CIP-56 indexer in
  `src/connect.ts`.

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

### 1. Building an OCI image

```bash
npm install --save-dev @types/node
npm run package:docker # or package:podman for Podman users
```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform.

### 2. Pushing to the artifact registry

```bash
docker login my-registry.my-kaleido.io

export IMAGE_TAG=v1-$(date +%Y%m%d%H%M%S)
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
npm run promote:docker
```

### 3. Deploying the provider

1. Go to the Kaleido platform UI within your running environment
2. Navigate to the **Operations and resources** page
3. Click the **+** button on the **Services** section, to begin creating a new service
4. Select the **Provider** service type
5. After you have named your service:
   a. Select your uploaded provider artifact tag from within your namespaced repository
   b. Drag and drop the `config/provider-config.json` into the configuration file input box
6. Finish creating the **Provider** service
