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

# 2. Configure (copy samples and fill in your values)
cp .env.sample .env
cp config/wfe-config.sample.yaml config/wfe-config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml

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

- **Multiple contracts** — create a separate stream and event processor for the ERC-20 contract constructor, to dynamically create the asset and pool definitions in the Asset Manager. And update the ERC-20 indexer to upsert the addresses and transfers for any contract address.
- **Scoped event filtering** — edit `logFilters` in `src/erc20/stream.ts` to filter events for indexed fields within the event signature i.e. index certain `from` and `to` addresses.
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

### 1. Building an OCI image

```bash
npm install --save-dev @types/node
npm run package:docker # or package:podman for Podman users
```

> **NOTE**: the image is built on `linux/amd64` for compatibility with the Kaleido platform. You will need to ensure that your build environment is compatible with `linux/amd64` for building the image. Such as with MacOS on Apple Silicon, Rosetta emulation must be enabled.

The image uses [distroless/nodejs22](https://github.com/GoogleContainerTools/distroless) on `linux/amd64`
for a minimal, shell-free runtime — required for hosting on the Kaleido platform.

### 2. Pushing to the artifact registry

Make sure you are logged into the artifact registry you want to push to. You can do this by running `docker login my-registry.my-kaleido.io`:

```bash
# or with podman
docker login my-registry.my-kaleido.io
```

To push to your artifact registry:
```bash
# Set the image tag - must be unique as tags for each promote as tags are immutable
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

### 4.Streaming events to the provider

You can then either use `npm run create-stream` to create a new stream pointed at your hosted provider, or go to your **EVM connector** service
and create a new stream pointed at your hosted provider via the `transactionEvents` stream factory and a copy of an ERC-20-compatible ABI.

### 5. Upgrading the provider

To upgrade the provider, you will need to create a new artifact tag and promote it to the artifact registry.

```bash
npm run package:docker # or package:podman for Podman users
export IMAGE_TAG=v2-$(date +%Y%m%d%H%M%S)
npm run promote:docker # or promote:podman for Podman users, or promote:crane if copying from an existing OCI registry via Crane
```

Then, you can patch the existing provider either in the UI by editing the service settings, or by running the following commands:

```bash
# NOTE: this will extract the platform URL and API credentials from the WFE config file,
#       your API credentials will need privileges to patch the provider runtime if they do not already have them.
export RUNTIME_NAME=erc20-indexer-runtime
export IMAGE_REPOSITORY=my-namespace/{{PROVIDER_NAME}}
npm run patch-provider-runtime
```

If with your edits, you need to update the `config.json` for your provider, you can do so via the UI.

Otherwise, we encourage you to use https://github.com/kaleido-io/terraform-provider-kaleido to manage your provider runtime and service configurations as code, such as:

```hcl
resource "kaleido_platform_runtime" "erc20_indexer_runtime" {
  name = "erc20-indexer-runtime"
  type = "Provider"
  environment = var.environment_id
  image = {
    repository = "my-namespace/{{PROVIDER_NAME}}"
    tag = "v1"
  }
  config_json = jsonencode({})
}

resource "kaleido_platform_service" "erc20_indexer_service" {
  name = "erc20-indexer"
  type = "Provider"
  environment = var.environment_id
  runtime = kaleido_platform_runtime.erc20_indexer_runtime.id
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

1. New image tag not taken affect in the Provider runtime:
   - Ensure the new image tag has been promoted to the artifact registry
   - See the logs of the Provider runtime to watch for it stopping and restarting
   - Image updates may take up to 3 minutes to take affect

2. Provider is not receiving events:
   - Ensure the stream is pointing at the correct Provider
   - Ensure the Provider is running correctly
   - Ensure the Provider is reporting that it is connected to the Workflow Engine via the Provider proxy service
   - See the logs of the Provider proxy service to watch for it forwarding events to the Provider
   - Use the Provider proxy Swagger UI to `PUT /providers/{name}/reconnect` to force a reconnect of the Provider
   - See the Workflow engine logs, searching by your stream ID, to watch for it polling the event source, and sending them to event processor for the Provider
   - If the Workflow engine is unsuccesfully polling the EVM connector, see the EVM connector logs for any errors. It could be there are JSONRPC connectivity issues, or you need to decrease the `catchupPageSize` in the stream configuration to reduce the number of events polled from the chain at once.

3. Asset manager is not receiving transfers:
   - See the Provider logs for any errors when calling the Asset Manager APIs
   - Common causes are bad API key credentials, but if the indexer is receiving events from a misconfigured stream (multiple ERC-20 contracts for example) it
     may be trying to upsert addresses and transfers for an unknown contract address.
   - Bulk upsert API has limits on the number of addresses and transfers that can be upserted in a single call. If you are indexing a large number of addresses and transfers, you may need to split the upsert into multiple calls, or decrease the `batchSize` in the stream configuration to reduce the number of events processed at once.