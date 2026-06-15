# Umbrella SDK Restructure Plan

## Background

The current structure has two published packages:
- `@kaleido-io/workflow-engine-sdk` — WFE WebSocket client, transaction handlers, event sources/processors, CLI
- `@kaleido-io/asset-manager-sdk` — AssetManagerClient, Indexer base class, bulk upsert/query patterns

The `Indexer` base class is a cross-cutting concern: it depends on the WFE connection (for event processing) AND the Asset Manager (for data model writes). As the platform grows (key-manager, etc.), more such cross-cutting patterns will emerge. Keeping them in a service-specific package is architecturally wrong and produces confusing `npx @kaleido-io/workflow-engine-sdk init --template btc-indexer` invocations.

## Target Structure

```
packages/
  workflow-engine-sdk/    @kaleido-io/workflow-engine-sdk  — WFE client only, no cross-cutting
  asset-manager/          @kaleido-io/asset-manager-sdk    — AM client only, no cross-cutting  
  key-manager/            @kaleido-io/key-manager-sdk      — (future)
  sdk/                    @kaleido-io/sdk                  — umbrella: owns CLI, cross-cutting patterns
internal/
  core/                                                    — unchanged, bundled inline
```

### Dependency rules

- Individual service packages **never import from each other**
- `@kaleido-io/sdk` depends on all service packages — the only place cross-service patterns live
- `@kaleido-io/core` remains internal, bundled inline by each package that needs it

## What moves

| Item | From | To |
|------|------|----|
| `Indexer` base class | `asset-manager-sdk` | `@kaleido-io/sdk` |
| `bin/init.js`, `bin/wesdk.js` | `workflow-engine-sdk` | `@kaleido-io/sdk` |
| CLI binary entry (`wesdk` → `ksdk`) | `workflow-engine-sdk/package.json` | `sdk/package.json` |
| Future cross-service handler patterns | n/a | `@kaleido-io/sdk` |

## CLI change

```
npx @kaleido-io/sdk init my-indexer --template btc-indexer
```

The rename `wesdk` → `ksdk` (Kaleido SDK) happens at the same time since the CLI moves packages.

## Template package.json strategy

Templates declare exactly what they need — the init script reads `@kaleido-io/*` deps from the template's `package.json` and pins them in the generated project. No separate manifest required. This is the existing mechanism and continues to work correctly.

Generated projects may depend on:
- `@kaleido-io/sdk` only (simplest, recommended for most users)
- Individual packages (advanced users, leaner installs)

Templates should use `@kaleido-io/sdk` as the default since it shields consumers from internal package boundaries changing.

## Build order

```
internal/core → workflow-engine-sdk → asset-manager-sdk → [key-manager-sdk] → sdk (umbrella)
```

## Breaking changes

All breaking. Do after:
1. `djc/btc-indexer-refactor` PR is merged
2. Service bindings work on `getting-started` is complete and merged

The restructure is a single PR — moving files piecemeal would leave the repo in an inconsistent state.

## Validation checklist

- [ ] All existing samples compile against `@kaleido-io/sdk`
- [ ] `npx @kaleido-io/sdk init` works for all three templates
- [ ] Indexer base class accessible via `@kaleido-io/sdk`
- [ ] Individual packages still usable standalone (no regression for advanced consumers)
- [ ] Full CI passes (build order, Docker, wesdk-init jobs updated to `ksdk`)
- [ ] README updated
