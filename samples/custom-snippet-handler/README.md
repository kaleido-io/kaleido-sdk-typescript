# custom-snippet-handler

A Kaleido Workflow Engine provider that **dynamically registers transaction handlers** from a YAML config file. Each handler points at a `.ts` file on disk that exports an `actionMap`.

## Quick start

```bash
cd samples/custom-snippet-handler
npm install

cp config/config.sample.yaml config/config.yaml
cp config/provider-config.sample.yaml config/provider-config.yaml
# Edit config/config.yaml — Workflow Engine URL and credentials
# Edit config/provider-config.yaml — add your handlers

npm run start:dev
```

On startup the provider reads `config/provider-config.yaml`, imports each handler file, and registers them with the Workflow Engine. The `handlers` array may be empty — the provider still connects and registers with WFE (with zero transaction handlers).

## Handler config

`config/provider-config.yaml`:

```yaml
# Start with none:
handlers: []

# Or list handler implementations:
handlers:
  - name: hello
    file: handlers/hello.ts
```

| Field  | Description |
|--------|-------------|
| `name` | Provider handler name (used in workflow `handlerBindings`) |
| `file` | Path to the handler implementation (`.ts` or `.js`). Relative paths resolve from the provider working directory; the Kaleido platform may supply an absolute mount path. |

Each handler file must export `actionMap`. See [handlers/README.md](./handlers/README.md).

Set `CONFIG_FILE` to use a different config path (default: `./config/provider-config.yaml`).

### Hosted / Kubernetes

When running as a Kaleido provider runtime, the platform generates `provider-config.yaml` and mounts snippet implementations at the paths listed in each handler's `file` field. Those paths may be anywhere on the filesystem.

The provider runs on a **read-only root filesystem** with no writable `/tmp`. Production startup uses Node's `--experimental-strip-types` (not `tsx`). Platform-mounted snippet files (outside the provider working directory) are **bundled in memory with esbuild** so imports like `@kaleido-io/workflow-engine-sdk` resolve from the provider's `node_modules`.

If startup fails with `Handler file not found`, check that:

1. The path in `provider-config.yaml` matches where the platform mounted the snippet file
2. The snippet file is present in the pod (`kubectl exec` and `ls` the path from the error)
3. The handler file exports an `actionMap`

## Hot reload (dev)

With `npm run start:dev`, hot reload is **on by default**. The provider watches:

- `config/provider-config.yaml`
- files under `handlers/`

On change it **stops, rebuilds the client from config, and reconnects** to WFE (Option A — no SDK changes). You'll see log lines like:

```
[hot-reload] Reloaded with 1 handler(s): hello
```

Disable with `HOT_RELOAD=false` (production `npm start` disables it automatically).

**Note:** Removing a handler from config does not unregister it from WFE until you restart the process — the SDK has no unregister API. Adding or updating handlers via reload works as expected.

## Run commands

| Command | When to use |
|---------|-------------|
| `npm run start:dev` | **Development** — `tsx`, hot reload, loads `.ts` handler files directly |
| `npm run build && npm start` | **Production** — compiled `dist/`, loads `.js` snippets (or `.ts` via Node strip-types) |

## Try the sample

```bash
npm run create-workflow snippet/flow.ts
npm run create-transaction snippet/transaction.ts
```

## Adding a new handler

1. Create `handlers/my-handler.ts` exporting an `actionMap`
2. Add an entry to `config/provider-config.yaml`
3. Save — hot reload picks it up in dev (`npm run start:dev`), or restart for production
4. Bind a workflow stage to `providerHandler: my-handler`

## Upload handlers to artifact-registry

Upload `handlers/*.ts` snippets to Kaleido artifact-registry (one repository per handler). Each upload is **`multipart/form-data`** with form fields **`type=typescript`** and **`file`** (the `.ts` source).

```bash
cp scripts/env.example /tmp/areg-env
# edit AREG_API, credentials, AREG_NS_FILE, AREG_TAG
source /tmp/areg-env
npm run upload:handlers
```

| Variable | Default | Description |
|----------|---------|-------------|
| `AREG_API` | (required) | Admin REST base, e.g. `https://…/rest/api/v1` |
| `AREG_NS_FILE` | `platform-files-demo` | `file` artifact family namespace |
| `AREG_TAG` | `1.0.0` | Version tag for each upload |
| `AREG_REPO_PREFIX` | (empty) | Optional repo name prefix |
| `AREG_HANDLERS_DIR` | `./handlers` | Directory to scan for `.ts` handlers |

`hello.ts` uploads to repository `hello` at tag `AREG_TAG`. Skips `*.test.ts` files.

## Bootstrap with samples-sdk

```bash
# From repo root
npm pack --workspace packages/samples-sdk

KSDK_REPO_URL="/path/to/kaleido-sdk-typescript" \
  npx "file:/path/to/kaleido-sdk-typescript/packages/samples-sdk/kaleido-io-samples-sdk-1.0.0-rc1.tgz" \
  init custom-snippet-handler --template workflow-engine-provider
```

Then replace `connect.ts` with this sample's dynamic registration approach.
