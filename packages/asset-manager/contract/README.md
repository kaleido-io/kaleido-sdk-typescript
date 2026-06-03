# Asset Manager contract tests

Behavioral scenarios defined once, run against two backends:

| Runner                                 | Backend                     | When                                  |
| -------------------------------------- | --------------------------- | ------------------------------------- |
| `runners/mock.contract.spec.ts`        | `MockAssetManagerClient`    | Every PR — fast, no infra             |
| `runners/integration.contract.spec.ts` | `AssetManagerClient` + HTTP | Nightly / manual — catches mock drift |

subgraph registrars ["Shared registrars"]
bulkUpsert["bulk-upsert.ts"]
balances["balances.ts"]
bulkQuery["bulk-query.ts"]
subscriptions["subscriptions.ts"]
cascadeDelete["cascade-delete.ts"]

mockRunner["mock.contract.spec.ts"]
integrationRunner["integration.contract.spec.ts"]

registrars --> mockRunner
registrars --> integrationRunner

## Running locally

From `packages/asset-manager/`:

```bash
# Mock only (default CI)
npm run test:contract

# All unit + contract tests
npm test
```

### Debugging in VS Code

Open the `kaleido-sdk-typescript` repo root (so `${workspaceFolder}` resolves correctly). Launch configs live in [`.vscode/launch.json`](../../.vscode/launch.json):

| Config | Use when |
|--------|----------|
| **Debug Contract Tests (mock)** | Run all mock contract tests |
| **Debug Contract Tests (mock, by name)** | Filter by test name regex (prompt) |
| **Debug Contract Tests (integration)** | Run all integration tests; reads [`.env`](../.env) |
| **Debug Contract Tests (integration, by name)** | Filter integration tests by name |
| **Debug Current Contract Runner** | F5 on `mock.contract.spec.ts` |
| **Debug Current Contract Runner (integration)** | F5 on `integration.contract.spec.ts`; reads `.env` |

Use the configs **without** “by name” to run the full suite. The “by name” variants prompt for a regex (default `.*`).

Create `packages/asset-manager/.env` from the example (gitignored):

```bash
cp .env.example .env
# edit AM_CONTRACT_URL, AM_USER, AM_PASS
```

Scenario files (`contract/scenarios/*.ts`) are imported by the runners — set breakpoints there, then launch a runner with a `testNamePattern` matching the `describe`/`it` name (e.g. `denormalizes asset onto pool`).

## Running against a real Asset Manager

Copy and fill in [`.env`](../.env):

```bash
cd packages/asset-manager
cp .env.example .env
# edit AM_CONTRACT_URL, AM_USER, AM_PASS

npm run test:contract:integration
```

`.env` is loaded automatically via `dotenv-cli`. If `AM_CONTRACT_URL` is unset, the integration suite is skipped (`describe.skip`).

### Isolation

Integration scenarios use `contractPrefix()` and `resourceName(prefix, …)` so every resource name is unique per test (`contract-<uuid>-…`). Queries are scoped to those names — never assume an empty database.

### Backend differences (same tests, both runners)

Every scenario runs on mock and real AM. Helpers in `contract/helpers.ts` normalize API differences:

| Area | Approach |
|------|----------|
| Pool ↔ asset linkage | `expectPoolLinkedToAsset` via `bulkQuery` filter on both backends |
| Address-scoped pools | Separate `address` + `name` fields (production shape) |
| Balances | `latestBalanceForAddress` uses `bulkQuery` on `balanceChanges`; mock also asserts `getAssetBalances` where available |
| Subscriptions | Mock asserts in-process delivery (`listen` / `flushEvents`); real AM asserts event topics via `bulkQuery` and subscription CRUD |
| `parent.ref` without `parent.type` | Mock throws `KA091215`; real AM returns HTTP 400 / `KA091214` |

## Writing scenarios

Each file under `scenarios/` exports a registrar function, not a top-level `describe`:

```typescript
export const registerBalanceScenarios: ContractRegistrar = (ctx) => {
  describe("balance bookkeeping", () => {
    let client: AssetManagerClient;

    beforeEach(() => {
      client = ctx.createClient();
    });

    it("...", async () => {
      await client.bulkUpsert({
        /* ... */
      });
    });
  });
};
```

Rules:

1. **Client API only** — use `bulkUpsert`, `bulkQuery`, `deleteAddress`, etc. Do not call `client.store.seed()` (that bypasses the client boundary).
2. **Unique names on real backend** — use `contractPrefix(ctx)` and `resourceName(prefix, shortName)` for every resource (including activities, events, and data).
3. **Register in both runners** — add the registrar to `mock.contract.spec.ts` and `integration.contract.spec.ts`.

### Contract context

```typescript
interface ContractContext {
  createClient: () => AssetManagerClient;
  backend: "mock" | "real";
}
```

## Scenario coverage (P1)

| Module              | Cases                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `bulk-upsert.ts`    | Inter-related graph; address-scoped pool qualifiedName; `create_or_ignore` vs `create_or_replace` |
| `balances.ts`       | Mint/transfer/burn; `balanceBefore`/`balanceAfter` chain; protocolId replay idempotency              |
| `bulk-query.ts`     | Events by `parent.type` + `parent.ref`; label eq/neq; error without `parent.type`                  |
| `subscriptions.ts`  | Topic filter; delivery/replay; `batchSize=1`                                                         |
| `cascade-delete.ts` | Address delete cascades pools, transfers, balanceChanges                                    |

## CI recommendations

| Job              | Command                                               |
| ---------------- | ----------------------------------------------------- |
| PR / default     | `npm run test:contract`                               |
| Nightly / manual | `npm run test:contract:integration` (requires `.env`) |

## Relationship to other tests

- `mock/store.spec.ts` — low-level store internals (`store.seed`, resolver edge cases)
- `contract/` — client-boundary behavioral parity (mock + optional real)
- Consumer app tests (e.g. bank-server e2e) — application event pipeline, not AM parity
