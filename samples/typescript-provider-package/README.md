# TypeScript provider snippet package

Handlers for the Kaleido TypeScript provider, developed as an ordinary npm project and uploaded as one zip. You write and test them locally, with type checking and the SDK's own types, and the platform runs them without you building an image.

## Create a project

```bash
npx @kaleido-io/kaleido-sdk init my-handlers --template typescript-provider-package
cd my-handlers
npm install
```

To match the TypeScript provider you deploy to, add `--sdk-version` with the `@kaleido-io/workflow-engine-sdk` version it runs. The project then depends on the SDK versions of that release.

## Develop

| Path | What it is |
|------|------------|
| `src/transaction/hello.ts` | A transaction handler with one action, `hello` |
| `src/eventsource/schedule.ts` | An event source that emits one event per interval |
| `src/processor/echo.ts` | An event processor that logs the events it receives |
| `src/lib/` | Code shared between handlers, reached with relative imports |
| `test/` | Unit tests, which run each action the way the engine does with `invokeAction` |

The `kaleido` section of `package.json` lists the handlers: the name each one registers under, and the file that exports it. Workflows and streams bind those names.

To add a handler, run one of:

```bash
npx ksdk add transaction-handler payments
npx ksdk add event-source ledger-feed
npx ksdk add event-processor ledger-writer
```

Each writes a starter file and a test, and adds the handler to the `kaleido` section.

```bash
npm test             # unit tests
npm run typecheck    # type check, with no build output
```

## Dependencies

A snippet package may depend only on `@kaleido-io/*` packages. The TypeScript provider supplies them, so the versions you can use are the ones its image ships. Build and test tools belong in `devDependencies`, which never leave your machine.

Shared code goes in the package itself, under `src/`.

## Package and upload

```bash
npm run package
```

This writes `<name>-<version>.zip`, leaving out `node_modules`, build output, lockfiles and anything `.gitignore` names, and checks the result against the same rules the platform applies. Upload the zip to the artifact registry namespace your TypeScript provider service uses, and add it to the service as a handler package.
