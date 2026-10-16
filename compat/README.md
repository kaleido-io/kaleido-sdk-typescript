# Compatibility suite

These checks protect existing consumers of the SDK. They were recorded against the published `1.0.1` packages and must keep passing on every change. A failure means a change could break a custom provider that already works.

| Check | What it covers | Run |
|---|---|---|
| Public API reports | The public declarations of `core-sdk` (every entry point) and `workflow-engine-sdk`, in each package's `api/` folder. CI fails when the declarations differ from the report. | `npm run api:check` (after `npm run build:packages`) |
| Consumer compile fixtures | Code written against `1.0.1`, in `consumer-fixtures/`, type-checked against the built packages. | `npm run compat:types` (after `npm run build:packages`) |
| Wire golden tests | Replies a real `WorkflowEngineClient` sends to a fake workflow engine, in `packages/workflow-engine-sdk/tests/compat/`. | `npm test -w packages/workflow-engine-sdk` |

## Changing a baseline

Additions to the public API are expected. Run `npm run api:update` and commit the updated reports, so the reviewer sees the new surface. A removal, a narrowed type or a newly required parameter is a breaking change and needs a major version.

Never edit a consumer fixture to make it compile. The fixtures under `consumer-fixtures/samples/` are frozen copies of the SDK samples as they were in `1.0.1`. The samples themselves can move to newer APIs, but these copies stay as they are. The files under `consumer-fixtures/legacy/` hold the other patterns that consumers use: hand-written handlers, direct calls from unit tests, and the client wiring.

A wire golden file changes only for an intended behaviour change. Regenerate it with `UPDATE_GOLDEN=1 npm test -w packages/workflow-engine-sdk -- tests/compat`, and explain the change in the pull request.
