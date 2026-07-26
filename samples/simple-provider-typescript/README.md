# simple-provider-typescript

A Kaleido Workflow Engine provider that **dynamically registers handlers** from a JSON config file. Each handler points at a `.ts` file on disk that exports the handler implementation.

## Quick start

```bash
cd samples/simple-provider-typescript
npm install

cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.json config/provider-config.json
# Edit config/config.yaml — Workflow Engine URL and credentials
# Edit config/provider-config.json — add your handlers

npm run start:dev
```

On startup the provider reads `config/provider-config.json`, dynamically imports each snippet file, and registers them with the Workflow Engine. All handler sections may be empty — the provider still connects and registers with WFE.

## Handler config

`config/provider-config.json`:

```json
{
  "transactionHandlers": [
    { "name": "hello", "file": "handlers/hello.ts" }
  ],
  "eventSources": [
    { "name": "tick-source", "file": "handlers/tick-source.ts" }
  ],
  "eventProcessors": [
    { "name": "echo", "file": "handlers/echo-processor.ts" }
  ]
}
```

| Section | Export from snippet file | WFE type |
|---------|--------------------------|----------|
| `transactionHandlers` | `actionMap` | Transaction handler |
| `eventSources` | `eventSource` (`createEventSource`) | Event source |
| `eventProcessors` | `processBatch` (or full `EventProcessorDef`) | Event processor |

| Field  | Description |
|--------|-------------|
| `name` | Provider handler name (must be unique across all sections) |
| `file` | Path to the implementation (`.ts` or `.js`). Relative paths resolve from the provider working directory; the platform may supply an absolute mount path. |

See [handlers/README.md](./handlers/README.md) for export shapes per type.

Set `CONFIG_FILE` to use a different config path (default: `./config/provider-config.json`).

Provider name and metadata for WFE registration live in `config.yaml` (`KALEIDO_CONFIG_FILE`).

### Hosted / Kubernetes

When running as a Kaleido provider runtime, the platform generates `provider-config.json` and mounts snippet implementations at the paths listed in each handler's `file` field.

The provider runs on a **read-only root filesystem**. Platform-mounted snippet files (outside the provider working directory) are **bundled in memory with esbuild** so imports like `@kaleido-io/workflow-engine-sdk` resolve from the provider's `node_modules`.

## Hot reload (dev)

With `npm run start:dev`, hot reload is **on by default**. The provider watches `config/provider-config.json` and files under handler directories.

## Run commands

| Command | When to use |
|---------|-------------|
| `npm run start:dev` | Development — `tsx`, hot reload, loads `.ts` handler files directly |
| `npm run build && npm start` | Production — compiled `dist/` |

## Docker

From monorepo root (builds SDK from source):

```bash
npm run package:docker
```

## Upload handlers to artifact-registry

```bash
npm run upload:handlers
```

See `scripts/env.example` for required environment variables.
