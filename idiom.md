# TypeScript Idiom Cleanup

Tracks Go-idiomatic patterns ported from the Go SDK that should be made TypeScript-idiomatic.
Breaking changes are acceptable (pre-v1). Groups are ordered by recommended execution order.

---

## Group A — Naming conventions

### A1. PascalCase exported function names ✅ DONE

**Problem:** Go convention is to capitalise exported identifiers. TS functions are camelCase.

| Symbol | File | Change |
|--------|------|--------|
| `NewWorkflowEngineClient` | `src/client/client_factory.ts` | → `newWorkflowEngineClient` → `createWorkflowEngineClient` |
| `HandlerSetFor` | `src/client/client_factory.ts` | → `handlerSetFor` |
| `isWebSocketConnected()` | `src/runtime/handler_runtime.ts`, `src/runtime/engine_client.ts`, `src/service/ws_proxy_adapter.ts` | method → `get isWebSocketConnected` property |
| `isConnected()` | `src/client/client.ts` | method → `get isConnected` property |

**All call-sites updated:**
- `src/index.ts:64-65` — named re-exports
- `src/client/client_factory.test.ts` — all test usages
- `src/client/client.ts:231` — comment reference

---

### A2. Go-style config key constants ✅ DONE

**Problem:** 20+ `export const ConfigXxx = "yaml-key"` at module scope mirrors Go's `const` block
pattern for string enumerations. All are internal to `config.ts` — none are used outside it.

**Fix:** Replace with three private grouped `as const` objects:
- `WFE_KEYS` — workflow-engine section keys
- `SERVER_KEYS` — server subsection keys
- `TLS_KEYS` — server.tls subsection keys

**Location:** `src/config/config.ts:53–82` (declarations), plus all usages throughout the same file.

---

## Group B — Interface design

### B1. `Handler.name()` as a zero-argument method ✅ DONE

**Problem:** `name(): string` is a no-arg method returning an immutable value. In TypeScript this
is a `readonly name: string` property. The current pattern forces `private _name` + a wrapper
method in every implementation — pure Go struct-field + getter idiom.

**Files to change:**
- `src/interfaces/handlers.ts:50` — `Handler` interface: change `name(): string` → `readonly name: string`
- `src/factories/transaction_handler.ts:49,60-62` — `TransactionHandlerBase`: remove `_name` field
  and `name()` method; add `readonly name: string` to constructor
- `src/factories/event_source.ts` — `EventSourceBase` or equivalent: same pattern
- `src/factories/event_processor.ts` — same
- `src/client/client_factory.ts:76` — call site changes from `handler.name()` to `handler.name`
- Any test mocks implementing `Handler`

**Note:** This is a breaking change for any external code implementing the `Handler` interface.
TypeScript compile errors will catch every call site.

---

### B2. `WithStageDirector.getStageDirector()` Go getter method ✅ DONE

**Problem:** `getStageDirector(): StageDirector` uses Go's `GetXxx()` convention. TypeScript
has native property syntax.

**Files to change:**
- `src/types/core.ts:87` — `WithStageDirector` interface: `getStageDirector(): StageDirector` → `stageDirector: StageDirector`
- `src/helpers/stage_director.ts:244-265` — runtime check for `getStageDirector` method and all call sites
- `src/client/client_factory.ts` — type guard `isTransactionHandler` etc. if they reference it
- All sample/consumer code that implements `WithStageDirector`

---

## Group B (continued) — Naming

### B3. `WithStageDirector` interface name — DEFERRED (name undecided)

**Problem:** The `With` prefix is Go's functional-options convention (e.g. `WithContext`,
`WithTimeout`). TypeScript constraint interfaces don't use this pattern.

**Current name:** `WithStageDirector` (`src/types/core.ts`, exported from `src/index.ts`)

**Candidate rejected:** `StageDirected` — sounds unnatural.

**Pending:** Agree on a replacement name before doing this rename. Once decided, it is a
mechanical find-and-replace across all generic constraints (`<T extends WithStageDirector>`),
all `implements WithStageDirector` declarations, and the public export. TypeScript compile
errors will catch every site.

**Note:** Do not confuse with the `stageDirector` *property* (lowercase), which was already
fixed in B2. This item is purely about the *interface type name*.

---

## Group C — Context parameter pattern

### C1. `reqContext: RequestContext` as mandatory first argument on every handler method

**Problem:** Every handler method signature begins with `reqContext: RequestContext` — a direct
translation of Go's `ctx context.Context` first-argument convention. The smoking gun: in
`src/factories/transaction_handler.ts:87` it is named `_reqContext` (unused) because the
interface mandates it but the implementation doesn't need it.

`RequestContext` carries:
- `requestId: string` — useful for logging
- `authTokens?: Record<string, string>` — needed by some handlers for auth
- `signal: AbortSignal` — for cancellation
- `cancel(): void` — to cancel the request

**Recommendation:** Move `reqContext` into the batch/request envelope objects that are already
passed (`WSHandleTransactions`, `WSListenerPollRequest`, `WSEventProcessorBatchRequest`).
Each envelope already has an `id` field for correlation; add `signal?: AbortSignal` and
`authTokens` to the envelope where needed, rather than as a separate positional argument.

**Files to change:**
- `src/types/core.ts:167-172` — `RequestContext` type (may become internal/removed)
- `src/interfaces/handlers.ts:63,84,91` — all three handler interface methods
- `src/factories/transaction_handler.ts:87` — implementation
- `src/factories/event_source.ts` — implementation
- `src/factories/event_processor.ts` — implementation
- `src/runtime/handler_runtime.ts` — where reqContext is constructed and passed
- `src/runtime/engine_client.ts` — `submitAsyncTransactions(reqContext, ...)` on `EngineAPI`
- All samples implementing these interfaces

**Risk:** Most breaking change in this list. Coordinate with all internal consumers first.
Run the full test suite after each file change. Consider doing as a single atomic PR.
