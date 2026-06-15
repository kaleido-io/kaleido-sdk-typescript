# Multi-Snippet Hosted Indexer — Design

## Goal

Allow a user to write a single JavaScript file containing `setup` and `indexBatch` functions and deploy it as a hosted indexer on the Kaleido platform via a UI. The platform handles the WFE connection, Asset Manager wiring, and stream creation. The user contributes only business logic.

---

## Target User Experience

The user writes one JS file:

```js
// my-erc20-indexer.js

const CONTRACT = '0xabc123...';
const POOL     = 'usdc/usdc';

export async function setup(ctx) {
  const b = new ctx.BulkUpsertBuilder(ctx.am);
  b.upsertAsset({ name: 'usdc', displayName: 'USD Coin', updateType: 'create_or_ignore' });
  b.upsertAddress({ address: CONTRACT, contract: true, updateType: 'create_or_ignore' });
  b.upsertPool({ name: 'usdc', asset: 'usdc', address: CONTRACT, standard: 'ERC20', updateType: 'create_or_ignore' });
  await b.execute();
}

export async function indexBatch(events, ctx) {
  const b = new ctx.BulkUpsertBuilder(ctx.am);
  for (const event of events) {
    for (const log of event.data.decodedEvents ?? []) {
      if (log.signature !== 'Transfer(address,address,uint256)') continue;
      b.upsertTransfer({
        protocolId: `${event.data.block.number}/${event.data.transactionHash}/${log.logIndex}`,
        from: log.data.from, to: log.data.to, amount: String(log.data.value),
        transactionHash: event.data.transactionHash,
        parent: { type: 'pool', ref: POOL },
        updateType: 'create_or_replace',
      });
    }
  }
  await b.execute();
  return { events };
}
```

That is the entire user contribution.

---

## How Batch Routing Works

This is the key mechanism that makes multi-snippet efficient. Each snippet registers as a **named event processor** on a single shared WS connection:

```
provider: "kaleido-hosted-indexers"
  ├── handler: "my-erc20-indexer"   ← registered by snippet 1
  └── handler: "my-btc-indexer"     ← registered by snippet 2
```

Each stream in the WFE targets a specific handler by name in its `eventProcessor` config:

```json
{
  "eventProcessor": {
    "type": "handler",
    "handler": {
      "provider": "kaleido-hosted-indexers",
      "name": "my-erc20-indexer"
    }
  }
}
```

The WFE routes batches server-side — ERC-20 batches go to `my-erc20-indexer`, BTC batches go to `my-btc-indexer`. The provider never demuxes; it just registers each snippet under its `name` and the protocol handles the rest.

The `name` in the snippet config entry becomes the handler name. `ensureStream()` already uses `handlerName()` when auto-creating streams, so each snippet's stream is created pointing at the correct handler automatically.

**Constraint:** snippet names must be unique within a provider. `MultiSnippetProvider` validates this at startup before registering anything.

---

## SDK Additions Required

### 1. `IndexerContext` — what gets passed to snippet functions

Rather than passing `am` and `config` as separate arguments, a context object makes the API stable and extensible:

```typescript
interface IndexerContext {
  am: IDataModelClient;
  BulkUpsertBuilder: typeof BulkUpsertBuilder; // no import needed in JS snippets
  log: Logger;
}
```

**No `config`** — for MVP, snippets are self-contained. Events arriving at the snippet are already filtered by the stream to the specific contract/network the user cares about, so the event data itself contains everything the snippet needs. Values like token names can be hardcoded or derived from the event. Per-snippet config (for parameterisation — same snippet, different contracts) is deferred to a later iteration; the context object is the natural extension point when that becomes needed.

**No `signal`** — cancellation is intentionally absent from the context. Snippets are pure business logic and should not need to handle connection lifecycle concerns. The provider threads the signal through to the AM client internally — if the WFE cancels a batch, the underlying HTTP call to the Asset Manager fails fast and the snippet sees a thrown error, the same as any other failure. Stopping mid-loop through events would not help since the payload is built incrementally and only written at `execute()` time.

Snippet signatures:

```typescript
export async function setup?(ctx: IndexerContext): Promise<void>
export async function indexBatch(
  events: EventProcessorEvent<unknown>[],
  ctx: IndexerContext,
): Promise<{ events: EventProcessorEvent<unknown>[] }>
```

`BulkUpsertBuilder` is injected into context so JS snippets don't need an import statement — important when snippets are loaded dynamically without a module bundler.

### 2. `Indexer.asEventProcessor(amClient)` — decouple from self-managed connection

Currently `Indexer.connect()` creates its own `WorkflowEngineClient` and calls `wfeClient.connect()` — one connection per indexer. For multi-snippet, multiple indexers must share one connection.

New method:

```typescript
// Returns a handler the caller can register on a shared WFE client.
// Does not open a WS connection.
asEventProcessor(amClient: IDataModelClient): EventProcessor
```

`connect()` remains valid for standalone use (calls `asEventProcessor` internally). No breaking change for existing users.

### 3. `createSnippetIndexer(def)` — class-free factory

Wraps a plain `{ setup?, indexBatch }` export in the Indexer pattern:

```typescript
interface IndexerSnippetDef {
  setup?: (ctx: IndexerContext) => Promise<void>;
  indexBatch: (
    events: EventProcessorEvent<unknown>[],
    ctx: IndexerContext,
  ) => Promise<{ events: EventProcessorEvent<unknown>[] }>;
}

function createSnippetIndexer(
  name: string,
  def: IndexerSnippetDef,
): {
  initialize(am: IDataModelClient): Promise<void>;
  asEventProcessor(am: IDataModelClient): EventProcessor;
}
```

`MultiSnippetProvider` calls this internally after `import()`-ing each snippet file. Users never call it directly.

### 4. `MultiSnippetProvider` — the hosted runner

```typescript
class MultiSnippetProvider {
  async run(): Promise<void>    // load → validate → init → register → connect
  async shutdown(): Promise<void>
}
```

`MultiSnippetProvider` reads from **two separate config files** with different purposes and different env vars:

| Env var | Content | Format |
|---------|---------|--------|
| `KALEIDO_CONFIG_FILE` | Platform connection (WFE URL, AM, auth) | Standard `IndexerConfig` YAML |
| `CONFIG_FILE` | Snippet manifest (names + file paths) | Custom YAML, TBD delivery mechanism |

Keeping these separate decouples the snippet delivery mechanism (not yet decided) from the Kaleido platform connection config. The manifest format is deliberately minimal — it is not a Kaleido config format.

Startup sequence:
1. Load platform config via `IndexerConfig.loadFromFile()` (`KALEIDO_CONFIG_FILE`)
2. Load snippet manifest via `CONFIG_FILE` env var
3. Validate snippet names are unique
4. Create the shared AM client from platform config (`environmentNameOrId` + `assetManagerNameOrId`)
5. `dynamic import()` each snippet file from paths in the manifest
6. Call `initialize()` on each (runs `setup()`)
7. Register each as a named event processor on a single `WorkflowEngineClient`
8. Call `ensureStream()` per snippet if `stream.autoCreate` is set in the manifest
9. Call `wfeClient.connect()`

---

## Config Structure

### Platform config (`KALEIDO_CONFIG_FILE`)

Standard `IndexerConfig` YAML — the same format used by standalone indexers. The top-level platform, WFE, and AM connection details are shared across all snippets. Contains no snippet-specific information.

```yaml
platform:
  url: https://myaccount.myinstance.kaleido.io/
  auth:
    username: myuser
    password: my-api-key

providerName: kaleido-hosted-indexers
environmentNameOrId: my-env
workflowEngineNameOrId: workflow-engine
assetManagerNameOrId: my-am       # one AM client shared by all snippets
```

### Snippet manifest (`CONFIG_FILE`)

A simple list of snippets. Format is custom — not a Kaleido platform config format. The mechanism by which this file and the referenced snippet files arrive on disk is TBD (file injection, platform API fetch at startup, etc.).

```yaml
snippets:
  - name: my-erc20-indexer        # becomes the WFE handler name — must be unique
    path: ./snippets/erc20-indexer.js
    stream:
      autoCreate: true
      factory: evmTransactions
      name: erc20-indexer
      eventSourceConfig:
        fromBlock: 'latest'
        batchSize: 50
        requiredConfirmations: 1
        abi: [...]

  - name: my-btc-indexer
    path: ./snippets/btc-indexer.js
    stream:
      autoCreate: true
      factory: transactionEvents
      name: btc-indexer
      eventSourceConfig:
        unfiltered: true
        fromBlock: '0'
        batchSize: 5
        requiredConfirmations: 5
```

---

## TypeScript types

```typescript
interface SnippetEntry {
  name: string;          // WFE handler name — must be unique within the provider
  path: string;          // path to JS file, resolved relative to the manifest file
  stream?: {
    autoCreate?: boolean;
    factory?: string;
    name?: string;
    description?: string;
    eventSourceConfig?: unknown;
  };
}

interface SnippetManifest {
  snippets: SnippetEntry[];
}
```

---

## Snippet Validation

### Iteration 1 — Structural validation (MVP)

After `dynamic import()`, before calling `setup()` or registering any handler:

- `indexBatch` is exported and is a function — hard requirement, fail fast
- `setup` if present is a function — warn and ignore if exported but not callable
- No duplicate handler names across all snippets in the manifest

Failures surface as startup errors before the WFE connection opens. The provider exits with a clear message rather than failing silently on the first live batch.

### Future — Dry-run against a mock AM client

Call `setup()` (if present) with a mock `IDataModelClient` that records operations without executing them, then call `indexBatch()` with an empty event array. This would validate:

- `setup()` runs without throwing
- `BulkUpsertBuilder` calls are structurally valid
- Config fields the snippet expects are actually present
- Return shape of `indexBatch` is correct

This is the right foundation for a polished developer experience (immediate feedback in the UI before a snippet is deployed to a live provider) but is deferred to a later iteration.

### Not in scope

- **Sandboxing**: True isolation (Worker threads, Deno, V8 isolates) is a future concern. Snippets are treated as trusted code for v1.
- **Static AST analysis**: Checking for dangerous patterns (`process.exit`, raw `fs`, outbound `fetch`) is deferred.
- **TypeScript type-checking**: Snippets are plain JS at runtime; type annotations are for editor tooling only.

---

## Operator / Platform Side

| Concern | What's needed |
|---------|--------------|
| Snippet storage | CRUD API for snippet code + per-snippet config. Snippets are versioned resources. |
| Provider deployment | One provider container per WFE. On snippet change: SIGTERM + restart (v1) or hot-reload API call. |
| Snippet injection | Mount snippet files + generated config YAML into container at startup. Avoids `eval()` in SDK. |
| Stream auto-creation | When a snippet is saved with stream config, call `ensureStream()` — already implemented on `Indexer`. Platform can surface this as an API action. |
| AM service binding | Platform pre-configures `assetManagerNameOrId` in the generated config — user never sees it. |
| Health / monitoring | Provider exposes a health endpoint; platform restarts on failure. |

**v1 snippet injection:** mount files + config. No hot-reload. Restart on change is acceptable for v1.

---

## What Does Not Need to Change

- `BulkUpsertBuilder`, auto-flush, retry, and dependency-ordering — production-ready as-is
- The WS proxy transport for hosted AM access — already implemented
- `createEventProcessor()` factory — fine as-is
- The WFE protocol itself — no changes needed
- Existing `Indexer` subclasses (`BTCIndexer`, `ERC20Indexer`) — `connect()` remains valid, no migration required
