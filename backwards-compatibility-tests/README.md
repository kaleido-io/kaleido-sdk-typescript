# Backwards compatibility tests

These tests protect existing consumers of the SDK. They were recorded against the published `1.0.1` packages and must keep passing on every change. A failure means a change could break a custom provider that already works.

| Test | What it checks | Run |
|---|---|---|
| Public API reports | The public declarations of `core-sdk` (every entry point) and `workflow-engine-sdk`, in each package's `api/` folder. CI fails when the declarations differ from the report. | `npm run api:check` (after `npm run build:packages`) |
| `npm run backwards-compatibility:types` | Code written against `1.0.1`, in `fixtures/`, type-checked against the built packages. | `npm run backwards-compatibility:types` (after `npm run build:packages`) |
| Expected messages | Replies a real `WorkflowEngineClient` sends to a fake workflow engine, in `packages/workflow-engine-sdk/tests/backwards-compatibility/`. Every reply must match `data/expected-messages-*.json` there. | `npm test -w packages/workflow-engine-sdk` |

## Layout

- `fixtures/` in this directory holds code written against `1.0.1`, which is type-checked only.
- `packages/workflow-engine-sdk/tests/backwards-compatibility/` holds the message tests:
  - `fixtures/fake-engine.ts` is the fake workflow engine. It depends only on `ws` and Node built-ins, so other test suites can copy it unchanged; keep it that way.
  - `data/` holds the messages the tests expect, one `expected-messages-<type>.json` file per kind of message.
  - `helpers/expected-data-helper.ts` compares the messages a test records with its expected data.

## Changing expected behaviour

Additions to the public API are expected. Run `npm run api:update` and commit the updated reports, so the reviewer sees the new surface. A removal, a narrowed type or a newly required parameter is a breaking change and needs a major version.

Never edit a file in `fixtures/` to make it compile. The fixtures under `fixtures/samples/` are frozen copies of the SDK samples as they were in `1.0.1`. The samples themselves can move to newer APIs, but these copies stay as they are. The files under `fixtures/legacy/` hold the other patterns that consumers use: hand-written handlers, direct calls from unit tests, and the client wiring.

An expected messages file changes only for an intended behaviour change. Regenerate it with `UPDATE_EXPECTED_DATA=1 npm test -w packages/workflow-engine-sdk -- tests/backwards-compatibility`, and explain the change in the pull request.
