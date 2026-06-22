# getting-started

A sample Kaleido Workflow Engine provider demonstrating transaction handlers, event sources,
and event processors — the core building blocks for custom providers.

## Quick start

```bash
# 1. Initialize a new project from this template
npx @kaleido-io/sdk init my-provider --template getting-started
cd my-provider

# 2. Install dependencies
npm install

# 3. Copy and edit the config files
cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml
# Edit config/config.yaml — set providerName, url, and auth for your Workflow Engine
# Edit config/provider-config.yaml — adjust app-specific settings (e.g. HTTP invoke URL)

# 4. Run in dev mode (no build step needed)
npm run start:dev
```

Your provider will initialize and connect to the Workflow Engine. You should see:
```
[handler_runtime] Registering provider and handlers
```
Followed by handler registration messages. Your provider will then appear in the **Workflow engine** provider list in the Kaleido UI.

To trigger the `hello` handler:
```bash
# Define a workflow using the hello handler
npm run create-workflow hello/flow.ts

# Submit a transaction against that workflow
npm run create-transaction hello/transaction.ts
```

The transaction will appear in your Workflow Engine and transition to `succeeded` with a greeting message.

## Configuration

### `config/config.yaml`

> Copy `config/config.sample.yaml` to `config/config.yaml`

Contains the Workflow Engine connection. `providerName` must match the name registered in `provider.ts`.
Set `KALEIDO_CONFIG_FILE` env var to point to this file (default: `./config/config.yaml`).

### `config/provider-config.yaml`

> Copy `config/provider-config.sample.yaml` to `config/provider-config.yaml`

Contains app-specific settings (e.g. HTTP invoke URL). Optional — samples use built-in defaults if the file is missing.
Set `CONFIG_FILE` env var to point to this file (default: `./config/provider-config.yaml`).

## Included samples

- **[hello](./hello/README.md)** — A simple transaction handler that processes input and returns a greeting message
- **[http-invoke](./http-invoke/README.md)** — Demonstrates making HTTP requests to external APIs from within a transaction handler
- **[event-source](./event-source/README.md)** — Shows how to set up a custom event source that generates events and streams them to an event processor
- **[snap](./snap/README.md)** — By playing the card game "snap", this sample demonstrates a correlation stream that matches events from any event source with inflight transactions
- **list-pools** — Demonstrates calling the Asset Manager from a transaction handler, forwarding the caller's auth token via the provider proxy
- **block-indexer** — An event processor that indexes EVM block data into the Asset Manager
