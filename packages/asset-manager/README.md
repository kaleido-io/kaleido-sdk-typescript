# @kaleido-io/asset-manager-sdk

TypeScript client for the Kaleido Asset Manager REST API, plus an in-memory mock for integration tests.

## Install

From the monorepo (development):

```bash
npm install @kaleido-io/asset-manager-sdk
```

Until `@kaleido-io/core` and this package are published to a registry, downstream apps can vendor tarballs — see [Vendoring as a tarball](#vendoring-as-a-tarball).

## Quick start — real Asset Manager

```typescript
import { AssetManagerClient } from "@kaleido-io/asset-manager-sdk";

const client = new AssetManagerClient({
  transport: "http",
  url: "https://your-am-host/api", // base URL; client appends /api/v1/...
  auth: {
    type: "basic",
    username: process.env.AM_USER!,
    password: process.env.AM_PASS!,
  },
});

await client.bulkUpsert({
  assets: [{ name: "usd", updateType: "create_or_replace" }],
});
```

When connecting through a Kaleido service binding (e.g. from the workflow engine SDK), obtain transport options from the binding instead of constructing them manually:

```typescript
const options = kaleidoClient.getServiceClientOptions("asset-manager");
const am = new AssetManagerClient(options);
```

### Exports

| Import path                          | What you get                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| `@kaleido-io/asset-manager-sdk`      | `AssetManagerClient`, `BulkUpsertBuilder`, interfaces, `Indexer` |
| `@kaleido-io/asset-manager-sdk/mock` | `MockAssetManagerClient`, `AssetManagerStore`, test helpers      |

See [mock/README.md](./mock/README.md) for the in-memory test double.

## Vendoring as a tarball

`MockAssetManagerClient` extends `AssetManagerClient`, which depends on `@kaleido-io/core` at runtime. Until both packages are on npm, ship them as local tarballs.

### 1. Build and pack (from monorepo root)

```bash
npm run pack:vendor
# → vendor-out/kaleido-io-core-0.1.0.tgz
# → vendor-out/kaleido-io-asset-manager-sdk-0.1.0.tgz
```

This runs `build:packages` (including the ESM `tsc-esm-fix` postbuild) and packs both packages.

### 2. Copy into your project

```bash
mkdir -p vendor
cp /path/to/kaleido-sdk-typescript/vendor-out/*.tgz vendor/
```

### 3. Add file dependencies

```json
{
  "dependencies": {
    "@kaleido-io/core": "file:./vendor/kaleido-io-core-0.1.0.tgz",
    "@kaleido-io/asset-manager-sdk": "file:./vendor/kaleido-io-asset-manager-sdk-0.1.0.tgz"
  }
}
```

`@kaleido-io/workflow-engine-sdk` is a transitive dependency — if your app already has it from npm, npm dedupes it automatically.

### 4. Install

```bash
npm install
```

### Updating vendored copies

Re-run `npm run pack:vendor` in this repo, copy the new tarballs, and `npm install`. Version bumps show up as filename changes on the `file:` paths.

## Development

From `packages/asset-manager/`:

```bash
npm run build      # compile ESM + CJS to dist/ and dist-cjs/
npm test           # unit tests + contract tests (mock runner)
npm run test:contract              # contract suite against mock only (CI default)
npm run test:contract:integration  # requires .env (see contract/README.md)
```

## Contract tests

The `contract/` directory holds behavioral scenarios that run against both the mock and (optionally) a live Asset Manager. This catches mock drift before it reaches consumers like bank-server.

See [contract/README.md](./contract/README.md) for running integration tests against a real service.

## Related docs

- [mock/README.md](./mock/README.md) — mock API, subscriptions, NestJS wrapper template
- [contract/README.md](./contract/README.md) — contract test runners and CI split
- [am-mock-plan.md](../../am-mock-plan.md) — design rationale for the mock (repo root)

## License

Apache-2.0
