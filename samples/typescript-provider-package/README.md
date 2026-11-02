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

## Run it locally

```bash
cp config/local-bindings.sample.yaml config/local-bindings.yaml   # then fill in your environment
npm run start:local
```

`npm run start:local` runs the handlers on your machine, connected to an environment's workflow engine under the `providerName` in `config/local-bindings.yaml`, so workflows and streams bound to that name use them. It runs them exactly as a TypeScript provider does: the handlers are found the way `npm run package` finds them, each is bundled on its own, and its imports are checked against what the provider supplies. Code that works locally works once uploaded.

Each handler reads `config/provider-config.yaml` as `ctx.config`. That file is the package's default config and ships in the zip. To give one handler a file of its own, name it in `package.json`:

```json
"kaleido": { "handlerConfig": { "payments": "config/payments.yaml" } }
```

Set `CONFIG_FILE` to use a different default locally without changing the package.

A handler reads a secret with `ctx.secret('name')`, and sees only the secrets listed for it in `package.json`:

```json
"kaleido": { "handlerSecrets": { "payments": ["coreBankingApiKey"] } }
```

Only the names ship in the package. Run locally, the values come from `KALEIDO_SECRETS_DIR`, one directory per secret holding a file named `value`. On the platform, the console asks for each listed secret when the package is added to a TypeScript provider, and you can add others and choose which handlers see each one.

## Dependencies

A snippet package may depend only on `@kaleido-io/*` packages, `zod` and `ethers`. The TypeScript provider supplies them, so the versions you can use are the ones its image ships. Build and test tools belong in `devDependencies`, which never leave your machine.

Shared code goes in the package itself, under `src/`.

### Adding a supplied library

The template doesn't include `zod` or `ethers`. Add one when a handler needs it, with a range that matches the major version the TypeScript provider ships:

| Library | Range |
|---------|-------|
| `zod` | `^4.6.0` |
| `ethers` | `^6.17.0` |

```bash
npm install ethers@^6.17.0
```

```ts
import { keccak256, toUtf8Bytes } from 'ethers';

const digest = keccak256(toUtf8Bytes(input.reference));
```

Install a version within that range so your tests run against the same API the provider gives your handlers. A plain `npm install ethers` installs the latest release, which can be a newer major version than the provider has.

The provider checks each range a package declares against the version in its image, whether or not the package imports it. A package whose range the image doesn't satisfy is refused when it's loaded, with a message naming the version the provider has. So declare only the libraries you use, and leave out any you stop using.

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
