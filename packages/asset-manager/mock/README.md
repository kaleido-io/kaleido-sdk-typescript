# Asset Manager mock

In-memory drop-in for `AssetManagerClient`. Routes the same SDK methods through an `AssetManagerStore` that models ref resolution, asset denormalization, balance bookkeeping, cascade deletes, and in-process subscription delivery.

```typescript
import { MockAssetManagerClient } from "@kaleido-io/asset-manager-sdk/mock";
```

## When to use it

- **Integration tests** for apps that call Asset Manager (bank-server, DAS, indexers) without booting Postgres + the real AM service.
- **Contract tests** in this package — scenarios in `../contract/` exercise the mock via the public client API.
- **Local development** when AM is unavailable.

Prefer `bulkUpsert` / `bulkQuery` in tests that mirror production call paths. Direct `client.store.seed()` is fine for low-level store unit tests but bypasses the client boundary.

## Basic usage

```typescript
import { MockAssetManagerClient, counterIds } from "@kaleido-io/asset-manager-sdk/mock";

const client = new MockAssetManagerClient({ idGenerator: counterIds("k") });

await client.bulkUpsert({
  assets: [{ name: "usd", updateType: "create_or_replace" }],
  addresses: [{ address: "0xAAA", updateType: "create_or_replace" }],
  pools: [
    {
      name: "main",
      address: "0xAAA",
      asset: "usd",
      updateType: "create_or_replace",
    },
  ],
});

const pool = await client.getPool("0xAAA/main");
expect(pool?.asset).toBeDefined();
```

### Reset between tests

Each test should construct a fresh client (recommended) or call:

```typescript
client.reset(); // clears store + event bus
```

## Event subscriptions (test-only delivery)

The mock does not open WebSockets. Subscriptions deliver events in-process when you explicitly flush:

```typescript
await client.replaceSubscription("blockchain-events", {
  name: "blockchain-events",
  topicFilter: "erc20/.*",
});

const batches: EventBatchDelivery[] = [];
client.listen("blockchain-events", (batch) => batches.push(batch));

await client.bulkUpsert({
  activities: [{ name: "erc20", updateType: "create_or_replace" }],
  events: [
    { name: "Minted", activity: "erc20", updateType: "create_or_replace" },
  ],
});

await client.flushEvents(); // manual mode (default)
expect(batches).toHaveLength(1);
```

`listen`, `flushEvents`, and `reset` exist on `MockAssetManagerClient` only — they are not part of the real HTTP client.

Replay from a cursor:

```typescript
await client.subscriptionReset("blockchain-events", { sequenceId: "1" });
await client.flushEvents();
```

## Out of scope (throws `MOCK000`)

Tasks, policies, invocations, and their version/inline variants are not implemented. Calling them rejects with code `MOCK000`. Stub per-test with `jest.spyOn` if needed.

## NestJS wrapper

Apps with a bespoke service layer (e.g. bank-server's `AssetManagerService` with `AuthContext` on every call) need a thin adapter. A complete template lives at:

```
mock/examples/nestjs-wrapper.ts.template
```

Copy it into your app and override the provider in tests:

```typescript
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(AssetManagerService)
  .useClass(MockAssetManagerService)
  .compile();

const am = moduleFixture.get(AssetManagerService) as unknown as MockAssetManagerService;
am.client.store.seed({ assets: [{ name: "usd" }] });
await am.client.flushEvents();
```

## Vendoring the mock into another repo

The mock is published as part of `@kaleido-io/asset-manager-sdk` via the `./mock` subpath export. See the [package README](../README.md#vendoring-as-a-tarball) for tarball workflow.

After vendoring:

```json
{
  "dependencies": {
    "@kaleido-io/core": "file:./vendor/kaleido-io-core-0.1.0.tgz",
    "@kaleido-io/asset-manager-sdk": "file:./vendor/kaleido-io-asset-manager-sdk-0.1.0.tgz"
  }
}
```

```typescript
import { MockAssetManagerClient } from "@kaleido-io/asset-manager-sdk/mock";
```

Both ESM (`dist/mock/`) and CommonJS (`dist-cjs/mock/`) builds are included in the tarball.

## Compile-time guardrail

`MockAssetManagerClient extends AssetManagerClient`. If the SDK adds a method the mock does not override, TypeScript assignment checks in contract tests will fail at build time.

## Further reading

- [am-mock-plan.md](../../../am-mock-plan.md) — data model behaviors the mock must replicate
- [contract/README.md](../contract/README.md) — shared behavioral scenarios
