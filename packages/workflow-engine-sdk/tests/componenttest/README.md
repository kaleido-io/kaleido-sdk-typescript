# Component Tests

Component tests for the Workflow Engine TypeScript SDK that test against a live workflow engine instance.

## Overview

These tests mirror the workflow engine component test suite and use the same workflow YAML files. They verify end-to-end functionality including:

- Handler registration and execution
- WebSocket communication
- Transaction processing
- Event sources and correlation
- Triggers and event matching
- Complex workflow scenarios

## Tests

### Three-Ringed Circus (`three-ringed-circus.test.ts`)

Tests a complex workflow where visitors circuit through three rings multiple times:
- Multiple actions (`enter`, `one`, `two`, `three`)
- JSON Patch state management
- Loop detection (returning to `one` from `three`)
- Exit conditions based on circuit count
- Config profiles for fast-exit mode
- Label-based organization (by tent)

Key features tested:
- StageDirector pattern with custom stages
- State updates with JSON Patch operations
- Handler invocation in PARALLEL mode
- Transaction retries with TRANSIENT_ERROR
- Complex state management across multiple stages

### Snap (`snap.test.ts`)

Tests event-driven workflow with triggers and correlation:
- Event source polling (dealer)
- Trigger creation and matching
- Topic-based correlation
- WAITING result for pending transactions
- Event batching and timing

Key features tested:
- Trigger generation from handlers
- Event source with checkpoint management
- Topic-based event matching
- Correlation between transactions and events
- Dealer event source that simulates card dealing

## Running Tests

### Prerequisites

The workflow engine must be running before tests execute. Tests do NOT start the engine themselves.

```bash
# From workflow-engine directory
make run-compose
```

### Run Component Tests

```bash
# From common/ts-wesdk directory
npm run test:component
```

### Configuration

Tests use the standard `WorkflowEngineConfig` format via `test-config.yaml`:

```yaml
# Uses the same config format as SDK users would use
workflowEngine:
  url: http://localhost:5503
  auth:
    type: token  # 'token' or 'basic' (AuthType enum)
    token: dev-token-123
    header: X-Kld-Authz
    scheme: ""  # Empty for raw token, "Bearer" for Bearer token
  # Workflow engine settings
  maxRetries: 5
  retryDelay: 2s
  batchSize: 10
  batchTimeout: 500ms
```

**Auth Types (AuthType enum):**
- `token`: Token-based auth (supports custom headers and schemes)
- `basic`: Username/password auth (automatically uses Basic Auth)

This ensures tests behave the same way as actual SDK users.

### Environment Variable Overrides

You can override config file values with environment variables:

- `FLOW_ENGINE_URL`: Workflow engine URL
- `WORKFLOW_ENGINE_AUTH_TOKEN`: Auth token
- `WORKFLOW_ENGINE_AUTH_HEADER`: Auth header name
- `WORKFLOW_ENGINE_AUTH_SCHEME`: Auth scheme

Example:
```bash
FLOW_ENGINE_URL=http://localhost:8080 npm run test:component
```

### In CI

The GitHub Actions workflow (`.github/workflows/workflow-engine-sdk-ts.yaml`) automatically:
1. Starts the workflow engine with `make run-compose`
2. Runs unit tests
3. Runs E2E tests
4. Runs component tests (using `test-config.yaml`)
5. Stops the workflow engine

## Workflow Files

Workflow YAML files are located in `tests/componenttest/workflows/`:

- `three-ringed-circus.yaml` - Standard multi-ring circuit
- `three-ringed-circus_with_profile.yaml` - With config profile support
- `snap.yaml` - Card game with triggers and events

These files are copied from `workflow-engine/test/componenttest/workflows/` and should remain identical to ensure consistency with the workflow engine test suite.

## Cleanup

Tests automatically clean up after themselves:
- Disconnect SDKs
- Delete created streams
- Delete created transactions
- Delete created workflows

If tests fail or are interrupted, resources may remain in the workflow engine and need manual cleanup.

## Test Patterns

### Handler Registration

```typescript
const client = new WorkflowEngineClient({
  url: 'ws://localhost:5503/ws',
  authToken: AUTH_TOKEN,
  providerName: 'my-provider',
});

const actionMap = new Map();
actionMap.set('my-action', {
  invocationMode: InvocationMode.PARALLEL,
  handler: async (transaction, input) => ({
    result: EvalResult.COMPLETE,
    output: { /* ... */ }
  })
});

const handler = newDirectedTransactionHandler('handler-name', actionMap);
client.registerTransactionHandler('handler-name', handler);
await client.connect();
```

### Workflow Submission

```typescript
const workflowYAML = fs.readFileSync('workflows/my-workflow.yaml', 'utf8');

const response = await fetch(`http://${FLOW_ENGINE_ADDRESS}/api/v1/workflows`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-yaml',
    [AUTH_HEADER_NAME]: AUTH_TOKEN
  },
  body: workflowYAML
});

const workflow = await response.json();
```

### Transaction Submission

```typescript
const response = await fetch(`http://${FLOW_ENGINE_ADDRESS}/api/v1/transactions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    [AUTH_HEADER_NAME]: AUTH_TOKEN
  },
  body: JSON.stringify({
    workflowId: workflow.id,
    operation: 'my-operation',
    input: { /* ... */ }
  })
});

const tx = await response.json();
```

### Event Source

```typescript
const eventSource = {
  name: () => 'my-source',
  init: async () => {},
  close: () => {},
  eventSourcePoll: async (config, result, request) => {
    result.events = [
      {
        idempotencyKey: 'unique-key',
        topic: 'my-topic',
        data: { /* ... */ }
      }
    ];
    result.checkpoint = { /* ... */ };
  },
  eventSourceValidateConfig: async () => {},
  eventSourceDelete: async () => {}
};

sdk.registerEventSource('my-source', eventSource);
```

## Implementation notes

1. **No Test Engine Management**: Tests assume the workflow engine is already running
2. **HTTP API for Workflows**: Workflows are submitted via HTTP (YAML)
3. **Async flow**: Uses promises for async/await
4. **Cleanup**: Uses `afterAll` with fetch DELETE requests

## Debugging

To debug failing tests:

1. Check workflow engine logs:
   ```bash
   docker compose -f workflow-engine/hack/dev.compose.yaml logs workflow-engine
   ```

2. Check database state:
   ```bash
   docker compose -f workflow-engine/hack/dev.compose.yaml exec postgres psql -U comptest
   ```

3. Enable debug logging in tests:
   ```typescript
   import { setLogLevel, LogLevel } from '../../src/index';
   setLogLevel(LogLevel.DEBUG);
   ```

4. Increase test timeouts if needed (default is 3 minutes)

## Contributing

When adding new component tests:

1. Mirror the workflow engine component test structure
2. Use the same workflow YAML files
3. Add cleanup in `afterAll`
4. Set appropriate timeouts
5. Add documentation to this README

