# native-eth-indexer

A sample Kaleido Workflow Engine provider that indexes native ETH transfer events
into the [Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `native-eth-indexer`.
2. Registers an **event processor** (`indexer`) that receives decoded EVM
   transaction batches from a `transactionEvents`-compatible stream.
3. For every transaction it
   - Creates a transfer record for each native ETH value movement
   - Records balance changes (subtract from sender, add to receiver)

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - An **EVM connector** stack connected to your chosen EVM-compatible chain
  - An **Asset manager** service

## Running locally - within SDK repo

```bash
# 1. Build the SDK repo at the top level
npm run build

# 2. Change into the sample directory
cd samples/native-eth-indexer

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

Contains Kaleido platform connectivity (workflow engine URL/auth and service bindings).
Set `KALEIDO_CONFIG_FILE` env var to point to this file (default: `./config/config.yaml`).

### `config/provider-config.yaml`

> Copy `config/provider-config.sample.yaml` to `config/provider-config.yaml`

Contains provider-specific configuration (chain ID, network name, token symbol, stream settings).
Set `CONFIG_FILE` env var to point to this file (default: `./config/provider-config.yaml`).

## Hosting on the Kaleido platform

### Prerequisites

- In addition to the minimum prerequisites, you will need:
  - An **Artifact registry** service with an artifact **namespace** created
  - A **Provider proxy** service
  - To convert your `config.yaml` to `config.json`
    ```bash
    yq -o=json config/config.yaml > config/config.json
    ```

### Building an OCI image

There are two Dockerfile examples provided:

- `Dockerfile` - builds the sample standalone, pulling the SDK from npm
  ```sh
  # From the native-eth-indexer directory
  docker build --platform linux/amd64 -t native-eth-indexer .
  ```
- `Dockerfile.withsdk` - builds the sample including building the SDK locally
  ```sh
  # From root directory of repo
  docker build --platform linux/amd64 -t native-eth-indexer -f ./samples/native-eth-indexer/Dockerfile.withsdk .
  ```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform. On MacOS with Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) on `linux/amd64`
for a minimal, shell-free runtime — required for hosting on the Kaleido platform.

### Pushing to the artifact registry

```bash
# Set the image tag - must be unique as tags are immutable
export IMAGE_TAG=v1-$(date +%Y%m%d%H%M%S)
export ARTIFACT_REGISTRY=my-registry.my-kaleido.io/my-namespace
docker tag native-eth-indexer $ARTIFACT_REGISTRY/native-eth-indexer:$IMAGE_TAG
docker push $ARTIFACT_REGISTRY/native-eth-indexer:$IMAGE_TAG
```

### Deploying the provider

1. Go to the Kaleido platform UI within your running environment
2. Navigate to the **Operations and resources** page
3. Click the **+** button on the **Services** section to begin creating a new service
4. Select the **Provider** service type
5. After naming your service:
   a. Select your uploaded provider artifact tag from within your namespaced repository
   b. Drag and drop `config/config.json` into the configuration file input box
6. Finish creating the **Provider** service
7. View the **Logs** of the Provider runtime to confirm it is running correctly
8. Confirm the provider is connected within your **Provider proxy** service and registered in the **Workflow engine** provider list

### Streaming events to the provider

Create a stream pointing at your hosted provider via your **EVM connector** service using the `transactionEvents` stream factory, or use the stream auto-creation config in `provider-config.yaml`.

### Upgrading the provider

```bash
docker build --platform linux/amd64 -t native-eth-indexer .
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
docker tag native-eth-indexer $ARTIFACT_REGISTRY/native-eth-indexer:$IMAGE_TAG
docker push $ARTIFACT_REGISTRY/native-eth-indexer:$IMAGE_TAG
```

Then update the provider in the Kaleido UI by editing the service settings to point at the new image tag.

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
