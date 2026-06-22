# native-eth-indexer

A sample Kaleido Workflow Engine provider that indexes native ETH transfer events
into the [Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `native-eth-indexer`.
2. Registers an **event processor** (`indexer`) that receives decoded EVM
   transaction batches from a `nativeEthTransactions`-compatible stream.
3. For every transaction it
   - Creates a transfer record for each native ETH value movement
   - Records balance changes (subtract from sender, add to receiver)

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - An **EVM connector** stack connected to your chosen EVM-compatible chain
  - An **Asset manager** service

## Quick start

```bash
# 1. Initialize a new project from this template
npx @kaleido-io/sdk init my-eth-indexer --template native-eth-indexer
cd my-eth-indexer

# 2. Install dependencies
npm install

# 3. Copy and edit the config files
cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml
# Edit both files with your platform details

# 4. Run in dev mode (no build step needed)
npm run start:dev
```

## Configuration

### `config/config.yaml`

> Copy `config/config.sample.yaml` to `config/config.yaml`

Contains Workflow Engine connection details and service bindings.
Set `KALEIDO_CONFIG_FILE` env var to point to this file (default: `./config/config.yaml`).

### `config/provider-config.yaml`

> Copy `config/provider-config.sample.yaml` to `config/provider-config.yaml`

Contains provider-specific settings (chain ID, network name, token symbol, stream settings).
Set `CONFIG_FILE` env var to point to this file (default: `./config/provider-config.yaml`).

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

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform. You will need to ensure that your build environment is compatible with `linux/amd64` for building the image. Such as with MacOS on Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) on `linux/amd64`
for a minimal, shell-free runtime — required for hosting on the Kaleido platform.

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
3. Click the **+** button on the **Services** section to begin creating a new service
4. Select the **Provider** service type
5. After naming your service:
   a. Select your uploaded provider artifact tag from within your namespaced repository
   b. Drag and drop `config/provider-config.json` into the configuration file input box
6. Finish creating the **Provider** service
7. View the **Logs** of the Provider runtime to confirm it is running correctly
8. Confirm the provider is connected within your **Provider proxy** service and registered in the **Workflow engine** provider list

### 4. Streaming events to the provider

Create a stream pointing at your hosted provider via your **EVM connector** service using the `nativeEthTransactions` stream factory, or use the stream auto-creation config in `provider-config.yaml`.

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

1. **New image tag not taking effect**: Image updates may take up to 3 minutes. Check Provider runtime logs.

2. **Provider not receiving events**:
   - Confirm the stream is pointing at the correct Provider
   - Check Provider proxy logs for forwarding activity
   - Check Workflow engine logs filtered by your stream ID
   - Use the Provider proxy Swagger UI `PUT /providers/{name}/reconnect` to force reconnect

3. **Asset manager not receiving transfers**:
   - Check Provider logs for API errors
   - Common cause: bad API key credentials or misconfigured stream pointing at wrong contract address
   - If bulk upsert limits are hit, decrease `batchSize` in the stream configuration
