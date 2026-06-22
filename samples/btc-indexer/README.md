# bitcoin-indexer

A sample Kaleido Workflow Engine provider that indexes BTC UTXO coin transfer events
into the [Kaleido Asset Manager](https://docs.kaleido.io/platform/digital-assets/overview/).

## What it does

1. Connects to your Workflow Engine as a provider named `bitcoin-indexer`.
2. Registers an **event processor** (`indexer`) that receives decoded BTC
   transaction batches from a `btcTransactions`-compatible stream.
3. For every transaction it
   - Creates new fragments for minted coins
   - Marks existing coins as spent

> Note this lifecycle is important, but not the full lifecycle of your wallet and coin selection.
> See the Kaleido documentation for further details.

## Minimum Prerequisites

- A running Kaleido environment with:
  - A **Workflow engine** service
  - A **BTC connector** stack connected to your chosen Bitcoin chain
  - An **Asset manager** service

## Quick start

```bash
# 1. Initialize a new project from this template
npx @kaleido-io/sdk init my-btc-indexer --template btc-indexer
cd my-btc-indexer

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

Contains provider-specific settings (BTC network, token symbol, stream settings).
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
3. Click the **+** button on the **Services** section, to begin creating a new service
4. Select the **Provider** service type
5. After you have named your service:
   a. Select your uploaded provider artifact tag from within your namespaced repository
   b. Drag and drop the `config/provider-config.json` into the configuration file input box
6. Finish creating the **Provider** service
7. As the provider is provisioning, go to the underlying **Provider** runtime and view the **Logs** to ensure the provider is running correctly
8. Confirm you see the provider is connected within your **Provider proxy** service, and that it is registered within the **Workflow engine** service provider list

### 4. Streaming events to the provider

You can then either use `npm run create-stream` to create a new stream pointed at your hosted provider, or go to your **BTC connector** service
and create a new stream pointed at your hosted provider via the `transactionEvents` stream factory.

### 5. Upgrading the provider

To upgrade the provider, build a new image and promote it to the artifact registry:

```bash
npm run package:docker # or package:podman for Podman users
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
npm run promote:docker # or promote:podman for Podman users, or promote:crane if copying from an existing OCI registry via Crane
```

Then, you can patch the existing provider either in the UI by editing the service settings, or by running:

```bash
# NOTE: this will extract the platform URL and API credentials from config.yaml.
#       Your credentials will need privileges to patch the provider runtime.
export RUNTIME_NAME=bitcoin-indexer-runtime
export IMAGE_REPOSITORY=my-namespace/btc-indexer
npm run patch-provider-runtime
```

If you need to update the `provider-config.json` for your provider, you can do so via the UI.

Otherwise, we encourage you to use https://github.com/kaleido-io/terraform-provider-kaleido to manage your provider runtime and service configurations as code, such as:

```hcl
resource "kaleido_platform_runtime" "bitcoin_indexer_runtime" {
  name = "bitcoin-indexer-runtime"
  type = "Provider"
  environment = var.environment_id
  image = {
    repository = "my-namespace/btc-indexer"
    tag = "v1"
  }
  config_json = jsonencode({})
}

resource "kaleido_platform_service" "bitcoin_indexer_service" {
  name = "bitcoin-indexer"
  type = "Provider"
  environment = var.environment_id
  runtime = kaleido_platform_runtime.bitcoin_indexer_runtime.id
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

### Troubleshooting

1. New image tag not taking effect in the Provider runtime:
   - Ensure the new image tag has been promoted to the artifact registry
   - See the logs of the Provider runtime to watch for it stopping and restarting
   - Image updates may take up to 3 minutes to take effect

2. Provider is not receiving events:
   - Ensure the stream is pointing at the correct Provider
   - Ensure the Provider is running correctly
   - Ensure the Provider is reporting that it is connected to the Workflow Engine via the Provider proxy service
   - See the logs of the Provider proxy service to watch for it forwarding events to the Provider
   - Use the Provider proxy Swagger UI to `PUT /providers/{name}/reconnect` to force a reconnect of the Provider
   - See the Workflow engine logs, searching by your stream ID, to watch for it polling the event source, and sending them to event processor for the Provider
   - If the Workflow engine is unsuccessfully polling the BTC connector, see the BTC connector logs for any errors. It could be there are JSONRPC connectivity issues, or you need to decrease the `catchupPageSize` in the stream configuration to reduce the number of events polled from the chain at once.

3. Asset manager is not receiving transfers:
   - See the Provider logs for any errors when calling the Asset Manager APIs
   - Common causes are bad API key credentials, but if the indexer is receiving events from a misconfigured stream it may be trying to upsert addresses and transfers for an unknown contract address.
   - Bulk upsert API has limits on the number of addresses and transfers that can be upserted in a single call. If you are indexing a large number of addresses and transfers, you may need to split the upsert into multiple calls, or decrease the `batchSize` in the stream configuration to reduce the number of events processed at once.
