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
# 1. Install dependencies (from repo root)
npm install

# 2. Copy and edit the config file
cp samples/canton-cip56-indexer/config/config.sample.yaml samples/canton-cip56-indexer/config/config.yaml
# Edit config/config.yaml — set platform URL, auth, environment, asset manager, etc.
# See the Configuration section below for details on each field.

# 3. Run in dev mode (no build step needed)
cd samples/canton-cip56-indexer
npm run start:dev
```

The event stream is created automatically on first run when `stream.autoCreate: true`
is set in the config (the default in `config.sample.yaml`).

## Configuration

### `config/config.yaml`

> Copy `config/config.sample.yaml` to `config/config.yaml` and fill in your values.
> The `KALEIDO_CONFIG_FILE` environment variable can override the default path.

| Key | Description |
|-----|-------------|
| `platform.url` | Your Kaleido platform URL, e.g. `https://myaccount.myinstance.kaleido.io/` |
| `platform.auth.username` | Kaleido API key name |
| `platform.auth.password` | Kaleido API key value |
| `environmentNameOrId` | Name or ID of your Kaleido environment |
| `assetManagerNameOrId` | Name or ID of your Asset Manager service |
| `workflowEngineNameOrId` | Name or ID of your Workflow Engine service |
| `connectorNameOrId` | Name or ID of your Canton Connector service (used when `stream.autoCreate` is true) |
| `stream.autoCreate` | If `true`, creates the stream on startup if it does not already exist |
| `stream.factory` | Stream factory — must be `cantonContractEvents` |
| `stream.eventSourceConfig.parties` | List of Canton parties to subscribe to (empty = all) |
| `stream.eventSourceConfig.interfaceIds` | CIP-56 interface IDs to filter on |

## Customizing

This sample is yours to fork. Common customizations:

- **Additional interface filters** — edit `interfaceIds` in `config/config.yaml` to subscribe to more Canton contract interfaces.
- **Custom handler logic** — extend `indexBatch` in `src/canton/indexer.ts` to process additional contract types.
- **Multiple indexers** — create additional classes extending `Indexer` and register them in `src/connect.ts`.

## Hosting on the Kaleido platform

### Prerequisites

- In addition to the minimum prerequisites, you will need:
  - An **Artifact registry** service with an artifact **namespace** created
  - A **Provider proxy** service
  - To convert your `config/config.yaml` to `config/config.json`
    ```bash
    yq -o=json config/config.yaml > config/config.json
    ```

### 1. Building an OCI image

```bash
# From the canton-cip56-indexer directory
npm run package:docker # or package:podman for Podman users
```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform.
> On MacOS with Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) for a minimal, shell-free runtime.

### 2. Pushing to the artifact registry

```bash
docker login my-registry.my-kaleido.io

export IMAGE_TAG=v1-$(date +%Y%m%d%H%M%S)
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
npm run promote:docker # or promote:podman, or promote:crane
```

### 3. Deploying the provider

1. Go to the Kaleido platform UI within your running environment
2. Navigate to the **Operations and resources** page
3. Click the **+** button on the **Services** section, to begin creating a new service
4. Select the **Provider** service type
5. After you have named your service:
   a. Select your uploaded provider artifact tag from within your namespaced repository
   b. Drag and drop the `config/config.json` into the configuration file input box
6. Finish creating the **Provider** service
7. As the provider is provisioning, go to the underlying **Provider** runtime and view the **Logs** to ensure the provider is running correctly
8. Confirm you see the provider is connected within your **Provider proxy** service, and that it is registered within the **Workflow engine** service provider list

### 4. Upgrading the provider

```bash
npm run package:docker
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
npm run promote:docker
```

Then edit the provider runtime image tag in the Kaleido platform UI, or manage it via the
[Kaleido Terraform provider](https://github.com/kaleido-io/terraform-provider-kaleido).

### Troubleshooting

1. **Provider is not receiving events**
   - Ensure the stream is pointing at the correct Provider
   - Ensure the Provider is running and connected to the Workflow Engine via the Provider proxy service
   - Use the Provider proxy Swagger UI to `PUT /providers/{name}/reconnect` to force a reconnect

2. **Asset Manager is not receiving transfers**
   - Check Provider logs for errors calling the Asset Manager APIs
   - Common causes: bad API key credentials, or a misconfigured stream
   - If indexing large batches, decrease `batchSize` in the stream configuration
