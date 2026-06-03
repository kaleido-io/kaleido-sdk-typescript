# @kaleido-io/sdk

The Kaleido TypeScript SDK. Umbrella package that bundles the Workflow Engine SDK and Asset Manager SDK, and provides the `ksdk` CLI for scaffolding new provider projects.

## Quick start

### Installation

```bash
npm install @kaleido-io/sdk
```

### Create a new project

Scaffold a new provider project from a template:

```bash
# Start from the getting-started template
npx @kaleido-io/sdk init <project-name> --template getting-started

# Start from the ERC-20 indexer template
npx @kaleido-io/sdk init <project-name> --template erc20-indexer

# Start from the Bitcoin indexer template
npx @kaleido-io/sdk init <project-name> --template btc-indexer
```

Omit `--template` in an interactive terminal and you'll be prompted to choose one.

Available templates:

- **getting-started** — basic provider with example transaction handlers and event sources
- **erc20-indexer** — provider that indexes ERC-20 token events from an EVM chain
- **btc-indexer** — provider that indexes Bitcoin transactions from a Bitcoin node

This creates a new project directory with boilerplate config and a starter
provider that connects to your Kaleido workflow engine.

### Add a template to an existing project

Omit the project name to copy template source files into the current directory
instead of creating a new one. Only the `src/` and `config/` directories are
merged in — root files (`tsconfig.json`, `Dockerfile`, etc.) are left untouched:

```bash
cd my-existing-project
npx @kaleido-io/sdk init --template erc20-indexer
```

Any `@kaleido-io/*` dependencies required by the template are added to your
`package.json` automatically. Run `npm install` afterwards.

## What's included

`@kaleido-io/sdk` re-exports everything from both underlying packages, so you
only need a single import:

```typescript
import {
  WorkflowEngineClient,
  AssetManagerClient,
  Indexer,
  IndexerConfig,
  newDirectedTransactionHandler,
  BulkUpsertBuilder,
} from "@kaleido-io/sdk";
```

Chain-specific event types are available via sub-path exports:

```typescript
import type { EVMTransactionEvent } from "@kaleido-io/sdk/types/evm";
import type { BTCTransactionEvent } from "@kaleido-io/sdk/types/btc";
```

For more detail on the Workflow Engine SDK API, see the
[`@kaleido-io/workflow-engine-sdk` README](../workflow-engine-sdk/README.md).
