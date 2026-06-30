# canton-cip56-indexer

A sample Kaleido Workflow Engine provider that indexes Canton CIP-56 token
holding and transfer events into the
[Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `canton-cip56-indexer`.
2. Registers an **event processor** that receives Canton contract events from a
   `contractEvents`-compatible stream filtered on the CIP-56
   `HoldingV1` and `TransferInstructionV1` interface IDs.
3. Maps **Holding** creates/archives to Asset Manager fragments, transfers,
   balance changes, and the pool/asset definitions they belong to; and maps
   **TransferInstruction** creates to pending-transfer fragments.

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - A **Canton connector** stack connected to your Canton network
  - A CIP-56 compliant token deployed on your Canton network
  - An **Asset manager** service

## Quick start

```bash
# 1. Initialize a new project from this template
npx @kaleido-io/kaleido-sdk init my-canton-indexer --template canton-cip56-indexer
cd my-canton-indexer

# 2. Install dependencies
npm install

# 3. Copy and edit the config files
cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml
# Edit both files with your platform details

# 4. Run in dev mode (no build step needed)
npm run start:dev
```

The event stream is created automatically on first run via the stream auto-creation settings in `provider-config.yaml`.

## Configuration

### `config/config.yaml`

> Copy `config/config.sample.yaml` to `config/config.yaml`

Contains Workflow Engine connection details and service bindings.
Set `KALEIDO_CONFIG_FILE` env var to point to this file (default: `./config/config.yaml`).

| Key | Description |
|-----|-------------|
| `workflow-engine.providerName` | Must match the provider name registered in `src/connect.ts` |
| `workflow-engine.url` | Workflow Engine REST endpoint URL |
| `workflow-engine.auth` | API key name and value (used as HTTP Basic auth) |
| `service-bindings.asset-manager` | Asset Manager service endpoint and auth |
| `service-bindings.canton-connector` | Canton Connector service endpoint and auth |

### `config/provider-config.yaml`

> Copy `config/provider-config.sample.yaml` to `config/provider-config.yaml`

Contains provider-specific settings (stream configuration and CIP-56 interface filters).
Set `CONFIG_FILE` env var to point to this file (default: `./config/provider-config.yaml`).

| Key | Description |
|-----|-------------|
| `stream.connectorBindingName` | Must match the `canton-connector` service binding name in `config.yaml` |
| `stream.factory` | Must be `contractEvents` |
| `stream.eventSourceConfig.filters.parties` | Canton parties to subscribe to (empty = all) |
| `stream.eventSourceConfig.filters.interfaceIds` | CIP-56 interface IDs to filter on |

## Customizing

This sample is yours to fork. Common customizations:

- **Additional interface filters** — edit `interfaceIds` in `config/provider-config.yaml` to subscribe to more Canton contract interfaces.
- **Custom handler logic** — extend `indexBatch` in `src/canton/indexer.ts` to process additional contract types.
- **Multiple indexers** — create additional classes extending `Indexer` and register them in `src/connect.ts`.

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
npm run package:docker # or package:podman for Podman users
```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform.
> On MacOS with Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) for a minimal, shell-free runtime.

### 2. Pushing to the artifact registry

Make sure you are logged into the artifact registry you want to push to:

```bash
docker login my-registry.my-kaleido.io
```

To push to your artifact registry:
```bash
# Set the image tag - must be unique as tags are immutable
export IMAGE_TAG=v1-$(date +%Y%m%d%H%M%S)
# Set the artifact registry hostname
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
npm run promote:docker # or promote:podman for Podman users, or promote:crane if copying from an existing OCI registry via Crane
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
7. As the provider is provisioning, go to the underlying **Provider** runtime and view the **Logs** to ensure the provider is running correctly
8. Confirm you see the provider is connected within your **Provider proxy** service, and that it is registered within the **Workflow engine** service provider list

### 4. Streaming events to the provider

The stream is created automatically on first run via the auto-creation settings in `provider-config.yaml`. Alternatively, create a stream via your **Canton connector** service using the `contractEvents` stream factory.

### 5. Upgrading the provider

To upgrade the provider, build a new image and promote it to the artifact registry:

```bash
npm run package:docker # or package:podman for Podman users
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
npm run promote:docker # or promote:podman for Podman users, or promote:crane if copying from an existing OCI registry via Crane
```

Then update the provider in the Kaleido platform UI by editing the service settings to point at the new image tag, or manage it via the
[Kaleido Terraform provider](https://github.com/kaleido-io/terraform-provider-kaleido).

### Troubleshooting

1. **Provider is not receiving events**:
   - Ensure the stream is pointing at the correct Provider
   - Ensure the Provider is running and connected to the Workflow Engine via the Provider proxy service
   - Use the Provider proxy Swagger UI to `PUT /providers/{name}/reconnect` to force a reconnect

2. **Asset Manager is not receiving transfers**:
   - Check Provider logs for errors calling the Asset Manager APIs
   - Common causes: bad API key credentials, or a misconfigured stream
   - If indexing large batches, decrease `batchSize` in the stream configuration
