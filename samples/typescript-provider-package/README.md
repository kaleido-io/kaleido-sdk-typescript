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

Each handler file exports one handler, made with `defineTransactionHandler`, `defineEventSource` or `defineProcessor`, and the first argument is the name it registers under. Workflows and streams bind those names. `npm run package` finds the handlers in the code and lists them in the zip, so there is nothing else to keep up to date.

To add a handler, run one of:

```bash
npx ksdk add transaction-handler payments
npx ksdk add event-source ledger-feed
npx ksdk add event-processor ledger-writer
```

Each writes a starter file, named in its code, and a test.

```bash
npm test             # unit tests
npm run typecheck    # type check, with no build output
```

## Dependencies

A snippet package may depend only on `@kaleido-io/*` packages and `zod`. The TypeScript provider supplies them, so the versions you can use are the ones its image ships. Build and test tools belong in `devDependencies`, which never leave your machine.

Shared code goes in the package itself, under `src/`.

## Package and upload

```bash
npm run package
```

This writes `<name>-<version>.zip`, leaving out `node_modules`, build output, lockfiles and anything `.gitignore` names, and checks the result against the same rules the platform applies. Upload the zip to the artifact registry namespace your TypeScript provider service uses, and add it to the service as a handler package.

## Renaming or leaving out handlers

To change what the package offers without changing the code, add a `kaleido` section to `package.json`. When it is there, it is used instead of the handlers found in the code, so list every handler the package should offer:

```json
"kaleido": {
  "transactionHandlers": [{ "name": "hello", "entry": "src/transaction/hello.ts" }],
  "eventSources": [{ "name": "schedule", "entry": "src/eventsource/schedule.ts" }],
  "eventProcessors": [{ "name": "echo", "entry": "src/processor/echo.ts" }]
}
```

`npm run package` warns about any handler in the code that the section leaves out.
