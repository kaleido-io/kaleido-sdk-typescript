# Kaleido Workflow Engine TypeScript SDK

A TypeScript SDK for building handlers that integrate with the Kaleido workflow engine. Build transaction handlers, event sources, and event processors that participate in workflows with full type safety and automatic reconnection.

## Quick start

### Installation

```bash
npm install @kaleido-io/workflow-engine-sdk
```

### Create a new project

To get up and running with a sample project, you can use:

```bash
npx @kaleido-io/workflow-engine-sdk init <project-name>
```

This will create a new project in a directory named for project-name, and in a few short steps it can be up and connecting in to your Kaleido workflow engine.

### Integrating into an existing project

```typescript
import { 
  WorkflowEngineClient, 
  ConfigLoader,
  WorkflowEngineConfig,
  newDirectedTransactionHandler,
  InvocationMode,
  EvalResult 
} from '@kaleido-io/workflow-engine-sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// 1. Load configuration (your application handles file loading)
const configFile = fs.readFileSync('./config.yaml', 'utf8');
const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;

// 2. Use SDK's ConfigLoader to create client config with your provider name
//    The SDK handles authentication header setup and URL conversion automatically
const clientConfig = ConfigLoader.createClientConfig(config, 'my-service');

// 3. Create client
const client = new WorkflowEngineClient(clientConfig);

// 4. Create and register transaction handler
const actionMap = new Map([
  ['myAction', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction, input) => {
      return {
        result: EvalResult.COMPLETE,
        output: { success: true }
      };
    }
  }]
]);

const handler = newDirectedTransactionHandler('my-handler', actionMap);
client.registerTransactionHandler('my-handler', handler);

// 5. Connect
await client.connect();
```

## Core concepts

### WorkflowEngineClient

The main entry point that manages:
- Handler registration (transaction handlers and event sources)
- WebSocket connection lifecycle
- Automatic reconnection and re-registration
- Message routing between engine and handlers

```typescript
const client = new WorkflowEngineClient({
  url: 'ws://localhost:5503/ws',
  providerName: 'my-service',
  authToken: 'your-token',
  authHeaderName: 'X-Kld-Authz',  // Optional, defaults to X-Kld-Authz
  reconnectDelay: 2000,            // Optional, ms between reconnect attempts
  maxAttempts: undefined           // Optional, undefined = infinite retries (recommended)
});

// Register handlers
client.registerTransactionHandler('handler-name', transactionHandler);
client.registerEventSource('source-name', eventSource);

// Connect
await client.connect();

// Check connection status
if (client.isConnected()) {
  console.log('Connected!');
}

// Disconnect
client.disconnect();
```

### Configuration file format

If you choose to use YAML files, create a configuration file like this:

```yaml
# Basic authentication (username/password)
workflowEngine:
  url: http://localhost:5503
  auth:
    type: basic
    username: my-user
    password: my-password
  # maxRetries: undefined = infinite reconnection (recommended)
  # maxRetries: 5           # Optional: limit reconnection attempts
  retryDelay: 2s
  timeout: 30s
  batchSize: 10
  batchTimeout: 500ms
  pollDuration: 2s
```

**Or use token authentication:**

```yaml
# Token authentication (API key, JWT, etc.)
workflowEngine:
  url: http://localhost:5503
  auth:
    type: token
    token: dev-token-123
    header: X-Kld-Authz      # Optional, defaults to Authorization
    scheme: ""               # Optional, e.g. "Bearer" for "Bearer <token>"
  # maxRetries: undefined = infinite reconnection (recommended for long-running services)
  retryDelay: 2s
```

Load and use configuration:

```typescript
import { 
  ConfigLoader, 
  WorkflowEngineConfig 
} from '@kaleido-io/workflow-engine-sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// Your application loads configuration (the SDK doesn't load files)
const configFile = fs.readFileSync('./config.yaml', 'utf8');
const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;

// Use SDK's ConfigLoader to create client config with provider name (REQUIRED)
// Note: SDK automatically converts http:// to ws:// and adds /ws path
const clientConfig = ConfigLoader.createClientConfig(config, 'my-service');

// Optionally log summary (without sensitive data)
ConfigLoader.logConfigSummary(config);

// Create client
const client = new WorkflowEngineClient(clientConfig);
```

**URL Handling:**
- Config file uses HTTP URL: `http://localhost:5503` or `https://example.com`
- SDK automatically converts to WebSocket: `ws://localhost:5503/ws` or `wss://example.com/ws`
- `/ws` path is automatically added if not present

### Configuration Schema

```typescript
interface WorkflowEngineConfig {
  workflowEngine: {
    mode?: HandlerRuntimeMode;      // Defaults to outbound
    port?: number;                  // port used for the web socket server in inbound mode
    url?: string;                   // Workflow engine URL
    auth?: AuthConfig;              // Authentication (see below)
    timeout?: string;               // Request timeout (e.g. "30s")
    maxRetries?: number;            // Max reconnection attempts (undefined = infinite)
    retryDelay?: string;            // Delay between retries (e.g. "2s")
    batchSize?: number;             // Batch size for handlers
    batchTimeout?: string;          // Batch timeout (e.g. "500ms")
    pollDuration?: string;          // Event source poll duration
  };
}

// Authentication types
type AuthConfig = BasicAuth | TokenAuth;

interface BasicAuth {
  type: 'basic';                    // Must be 'basic'
  username: string;                 // Username
  password: string;                 // Password
}

interface TokenAuth {
  type: 'token';                    // Must be 'token'
  token: string;                    // API token
  header?: string;                  // Header name (default: 'Authorization')
  scheme?: string;                  // Scheme (e.g. 'Bearer', default: '')
}
```

### Configuration examples

**Outbound, basic auth:**
```yaml
workflowEngine:
  url: http://localhost:5503
  auth:
    type: basic
    username: admin
    password: secret123
```

**Outbound, token auth (raw token):**
```yaml
workflowEngine:
  url: http://localhost:5503
  auth:
    type: token
    token: dev-token-123
    header: X-Kld-Authz
    scheme: ""  # Empty string = raw token
```

**Outbound, token auth (bearer token):**
```yaml
workflowEngine:
  url: http://localhost:5503
  auth:
    type: token
    token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    scheme: Bearer  # Sends "Bearer <token>"
```

**Inbound:**

The client will wait for an inbound connection from the workflow engine
```yaml
workflowEngine:
  mode: inbound
  port: 12345
```

**With environment variable overrides:**
```typescript
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ConfigLoader, WorkflowEngineConfig } from '@kaleido-io/workflow-engine-sdk';

// Your application loads and merges config with env vars
const configFile = fs.readFileSync('./config.yaml', 'utf8');
const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;

// Override URL from environment
if (process.env.WORKFLOW_ENGINE_URL) {
  config.workflowEngine.url = process.env.WORKFLOW_ENGINE_URL;
}

// Override token from environment
if (process.env.WORKFLOW_ENGINE_TOKEN && 
    config.workflowEngine.auth.type === 'token') {
  config.workflowEngine.auth.token = process.env.WORKFLOW_ENGINE_TOKEN;
}

// SDK transforms config into client config
const clientConfig = ConfigLoader.createClientConfig(config, 'my-service');
```

## Transaction handlers

### Using the factory pattern

The recommended approach for building transaction handlers:

```typescript
import { 
  newDirectedTransactionHandler,
  InvocationMode,
  EvalResult,
  Patch
} from '@kaleido-io/workflow-engine-sdk';

// Define your input type
interface MyInput {
  action: string;
  data: string;
}

// Create action map
const actionMap = new Map([
  ['processData', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction, input: MyInput) => {
      // Process the data
      const result = processData(input.data);
      
      return {
        result: EvalResult.COMPLETE,
        output: { processed: result },
        extraUpdates: [
          Patch.add('/processedData', result)
        ]
      };
    }
  }],
  
  ['batchProcess', {
    invocationMode: InvocationMode.BATCH,
    batchHandler: async (transactions) => {
      // Process all transactions together
      const results = await processBatch(transactions.map(r => r.value));
      
      return results.map(result => ({
        result: EvalResult.COMPLETE,
        output: result
      }));
    }
  }]
]);

// Create handler
const handler = newDirectedTransactionHandler('my-handler', actionMap)
  .withInitFn(async (engAPI) => {
    // Initialize resources
    console.log('Handler initialized');
  })
  .withCloseFn(() => {
    // Cleanup resources
    console.log('Handler closed');
  });

client.registerTransactionHandler('my-handler', handler);
```

### Invocation modes

**PARALLEL**: Each transaction processed independently in parallel
```typescript
{
  invocationMode: InvocationMode.PARALLEL,
  handler: async (transaction, input) => {
    // Process single transaction
    return { result: EvalResult.COMPLETE };
  }
}
```

**BATCH**: All transactions in batch processed together
```typescript
{
  invocationMode: InvocationMode.BATCH,
  batchHandler: async (transactions) => {
    // Process all transactions at once
    const results = await batchProcess(transactions);
    return results;
  }
}
```

### Eval results

Return appropriate result based on outcome:

- `EvalResult.COMPLETE` - Success, proceed to next stage
- `EvalResult.WAITING` - Stay in current stage (waiting for event)
- `EvalResult.FIXABLE_ERROR` - Retry later
- `EvalResult.TRANSIENT_ERROR` - Temporary error, retry
- `EvalResult.HARD_FAILURE` - Permanent failure, go to failure stage

### State updates

Use JSON Patch operations to update workflow state:

```typescript
import { Patch } from '@kaleido-io/workflow-engine-sdk';

return {
  result: EvalResult.COMPLETE,
  stateUpdates: [
    Patch.add('/newField', 'value'),
    Patch.replace('/existingField', 'newValue'),
    Patch.remove('/oldField'),
    Patch.add('/array/-', 'append to array')
  ]
};
```

### Custom stage transitions

Override the default next stage:

```typescript
return {
  result: EvalResult.COMPLETE,
  customStage: 'custom-next-stage',  // Override default nextStage
  output: { data: 'result' }
};
```

### Triggers

Emit events to trigger other workflows:

```typescript
return {
  result: EvalResult.COMPLETE,
  triggers: [
    { topic: 'user.created' },
    { topic: 'notification.send', ephemeral: true }
  ]
};
```

### Handler events

Emit events directly from handlers:

```typescript
return {
  result: EvalResult.COMPLETE,
  events: [
    { topic: 'something-happened', data: {} }
  ]
};
```

## Event sources

Event sources poll external systems and emit events to the workflow engine.

### Creating an Event Source

```typescript
import { newEventSource } from '@kaleido-io/workflow-engine-sdk';

// Define your types
interface MyCheckpoint {
  lastId: number;
}

interface MyConfig {
  topic: string;
  pollInterval: number;
}

interface MyEventData {
  id: number;
  data: string;
}

// Create event source
const eventSource = newEventSource<MyCheckpoint, MyConfig, MyEventData>(
  'my-event-source',
  async (config, checkpointIn) => {
    // Poll for events
    const events = await fetchNewEvents(
      config.config.topic,
      checkpointIn?.lastId || 0
    );
    
    // Return checkpoint and events
    return {
      checkpointOut: { 
        lastId: events[events.length - 1]?.id || checkpointIn?.lastId || 0 
      },
      events: events.map(e => ({
        idempotencyKey: `event-${e.id}`,
        topic: config.config.topic,
        data: e
      }))
    };
  }
)
.withInitialCheckpoint(async (config) => {
  // Build initial checkpoint
  return { lastId: 0 };
})
.withConfigParser(async (info, configData) => {
  // Parse and validate config
  const config = configData as MyConfig;
  if (!config.topic) {
    throw new Error('topic is required');
  }
  return config;
})
.withDeleteFn(async (info) => {
  // Cleanup on deletion
  console.log(`Deleting event source: ${info.streamName}`);
})
.withInitFn(async (engAPI) => {
  // Initialize resources
  console.log('Event source initialized');
})
.withCloseFn(() => {
  // Cleanup resources
  console.log('Event source closed');
});

// Register event source
client.registerEventSource('my-event-source', eventSource);
```

### Event source lifecycle

1. **Validation**: `withConfigParser` validates stream configuration
2. **Initial checkpoint**: `withInitialCheckpoint` creates starting point
3. **Polling**: Poll function called repeatedly to fetch events
4. **Checkpoint update**: Checkpoint saved after each successful poll
5. **Resumption**: On restart, polling resumes from last checkpoint

### Real-world example: stellar ledgers

```typescript
interface StellarBlockCheckpoint {
  lastLedger: number;
}

interface StellarBlockConfig {
  topic: string;
  fromLedger?: string;
  batchSize?: number;
}

interface MinimalLedger {
  sequence: number;
  hash: string;
  closedAt: string;
}

const stellarBlocks = newEventSource<
  StellarBlockCheckpoint,
  StellarBlockConfig,
  MinimalLedger
>(
  'stellarBlocks',
  async (config, checkpointIn) => {
    const startLedger = checkpointIn ? checkpointIn.lastLedger + 1 : await getLatestLedger();
    const batchSize = config.config.batchSize || 10;
    
    const events = [];
    let newCheckpoint = startLedger - 1;
    
    for (let i = 0; i < batchSize; i++) {
      try {
        const ledger = await fetchLedger(startLedger + i);
        events.push({
          idempotencyKey: ledger.hash,
          topic: config.config.topic,
          data: {
            sequence: ledger.sequence,
            hash: ledger.hash,
            closedAt: ledger.closed_at
          }
        });
        newCheckpoint = ledger.sequence;
      } catch (error) {
        break; // Ledger not yet available
      }
    }
    
    return {
      checkpointOut: { lastLedger: newCheckpoint },
      events
    };
  }
)
.withInitialCheckpoint(async (config) => {
  const ledgerNum = config.fromLedger === 'latest' 
    ? await getLatestLedger()
    : parseInt(config.fromLedger || '0', 10);
  return { lastLedger: ledgerNum };
})
.withConfigParser(async (info, configData) => {
  const config = configData as StellarBlockConfig;
  if (!config.topic) {
    throw new Error('topic is required');
  }
  return config;
});
```

### Creating event streams

Event streams connect event sources to workflows:

```bash
curl -X PUT http://localhost:5503/api/v1/streams/my-stream \
  -H "Content-Type: application/json" \
  -H "X-Kld-Authz: dev-token-123" \
  -d '{
    "name": "my-stream",
    "started": true,
    "type": "correlation_stream",
    "listenerHandler": "my-event-source",
    "listenerHandlerProvider": "my-service",
    "config": {
      "topic": "my-topic",
      "pollInterval": 1000
    }
  }'
```

## EngineAPI

The `EngineAPI` interface allows handlers to make synchronous API calls back to the workflow engine during transaction processing.

### Submitting Async Transactions

```typescript
async function myHandler(transaction, input, engAPI: EngineAPI) {
  // Submit transactions to the engine
  const results = await engAPI.submitAsyncTransactions(
    transaction.authRef,
    [
      {
        workflowId: 'flw:abc123',
        operation: 'process',
        input: { data: 'value' }
      }
    ]
  );
  
  return {
    result: EvalResult.COMPLETE,
    output: { submittedTxs: results }
  };
}
```

## StageDirector pattern

For workflows with action-based routing and automatic stage transitions:

```typescript
import { BasicStageDirector, WithStageDirector } from '@kaleido-io/workflow-engine-sdk';

interface MyInput extends WithStageDirector {
  data: string;
}

class MyInputImpl implements MyInput {
  public stageDirector: BasicStageDirector;
  public data: string;

  constructor(input: any) {
    this.stageDirector = new BasicStageDirector(
      input.action,        // Action to execute
      input.outputPath,    // Where to store output
      input.nextStage,     // Stage on success
      input.failureStage   // Stage on failure
    );
    this.data = input.data;
  }

  getStageDirector() {
    return this.stageDirector;
  }
}

// The SDK automatically wraps plain JSON objects from the engine
// with a getStageDirector() method, so you can also use plain objects:
const actionMap = new Map([
  ['myAction', {
    invocationMode: InvocationMode.PARALLEL,
    handler: async (transaction, input: any) => {
      // input.action, input.outputPath, input.nextStage are available
      return {
        result: EvalResult.COMPLETE,
        output: { processed: input.data }
      };
    }
  }]
]);
```

## Error handling

### Handler errors

Return appropriate error results:

```typescript
handler: async (transaction, input) => {
  try {
    const result = await riskyOperation(input);
    return {
      result: EvalResult.COMPLETE,
      output: result
    };
  } catch (error) {
    if (isTransient(error)) {
      return {
        result: EvalResult.TRANSIENT_ERROR,
        error: error as Error
      };
    } else {
      return {
        result: EvalResult.HARD_FAILURE,
        error: error as Error
      };
    }
  }
}
```

### Connection errors

The client automatically handles:
- WebSocket disconnections
- Automatic reconnection with exponential backoff
- Handler re-registration on reconnect
- Connection health monitoring

Monitor connection events:

```typescript
// The SDK logs connection events automatically
// Check connection status programmatically:
if (!client.isConnected()) {
  console.warn('Client disconnected, will auto-reconnect');
}
```

## Logging

The SDK uses a structured logger:

```typescript
import { newLogger } from '@kaleido-io/workflow-engine-sdk';

const log = newLogger('my-component');

log.debug('Debug message', { metadata: 'value' });
log.info('Info message', { userId: 123 });
log.warn('Warning message', { reason: 'low memory' });
log.error('Error message', { error: err.message });
```

## Testing

### Unit tests

Mock the EngineAPI and test handlers in isolation:

```typescript
import { jest } from '@jest/globals';

describe('MyHandler', () => {
  it('should process data correctly', async () => {
    const mockEngAPI = {
      submitAsyncTransactions: jest.fn().mockResolvedValue([])
    };

    const transaction = {
      transactionId: 'ftx:test123',
      workflowId: 'flw:test',
      input: { action: 'process', data: 'test' }
    };

    const result = await myHandler(transaction, transaction.input, mockEngAPI);

    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toBeDefined();
  });
});
```

### Component tests

Test with a running workflow engine:

```typescript
import { 
  WorkflowEngineClient, 
  ConfigLoader,
  WorkflowEngineConfig 
} from '@kaleido-io/workflow-engine-sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// Helper to load test config (your test infrastructure)
function loadTestConfig(): WorkflowEngineConfig {
  const configFile = fs.readFileSync('./test-config.yaml', 'utf8');
  const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;
  
  // Override with environment variables if present
  if (process.env.WORKFLOW_ENGINE_URL) {
    config.workflowEngine.url = process.env.WORKFLOW_ENGINE_URL;
  }
  
  return config;
}

describe('Component Test', () => {
  let client: WorkflowEngineClient;
  const testConfig = loadTestConfig();

  beforeAll(async () => {
    // Use SDK's ConfigLoader to transform config
    const clientConfig = ConfigLoader.createClientConfig(testConfig, 'test-provider');
    client = new WorkflowEngineClient(clientConfig);

    client.registerTransactionHandler('my-handler', handler);
    await client.connect();
  });

  afterAll(() => {
    client.disconnect();
  });

  it('should process workflow end-to-end', async () => {
    // For REST API calls, extract auth headers from SDK config
    function getAuthHeaders(): Record<string, string> {
      const clientConfig = ConfigLoader.createClientConfig(testConfig, 'test-client');
      return clientConfig.options?.headers || {};
    }

    const authHeaders = getAuthHeaders();
    
    // Create workflow
    const workflowResponse = await fetch('http://localhost:5503/api/v1/workflows', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-yaml',
        ...authHeaders  // SDK handles auth automatically
      },
      body: workflowYAML
    });
    
    // Wait for completion and verify results
  });
});
```

## Examples

### Complete transaction handler example

```typescript
import {
  WorkflowEngineClient,
  WorkflowEngineConfig,
  newDirectedTransactionHandler,
  InvocationMode,
  EvalResult,
  Patch,
  ConfigLoader
} from '@kaleido-io/workflow-engine-sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface ProcessInput {
  action: string;
  userId: string;
  amount: number;
}

async function main() {
  // Load config (your application handles file loading)
  const configFile = fs.readFileSync('./config.yaml', 'utf8');
  const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;
  
  // SDK transforms config
  const clientConfig = ConfigLoader.createClientConfig(config, 'payment-service');

  // Create client
  const client = new WorkflowEngineClient(clientConfig);

  // Define actions
  const actionMap = new Map([
    ['validatePayment', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction, input: ProcessInput) => {
        if (input.amount <= 0) {
          return {
            result: EvalResult.HARD_FAILURE,
            error: new Error('Invalid amount')
          };
        }
        
        return {
          result: EvalResult.COMPLETE,
          output: { validated: true },
          extraUpdates: [
            Patch.add('/validation', { valid: true, timestamp: new Date() })
          ]
        };
      }
    }],

    ['processPayment', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction, input: ProcessInput) => {
        const paymentResult = await processPayment(input.userId, input.amount);
        
        return {
          result: EvalResult.COMPLETE,
          output: paymentResult,
          triggers: [
            { topic: 'payment.completed' }
          ]
        };
      }
    }]
  ]);

  // Create handler
  const handler = newDirectedTransactionHandler('payment-handler', actionMap)
    .withInitFn(async (engAPI) => {
      console.log('Payment handler initialized');
    })
    .withCloseFn(() => {
      console.log('Payment handler closed');
    });

  // Register and connect
  client.registerTransactionHandler('payment-handler', handler);
  await client.connect();

  console.log('Payment service ready');
}

main().catch(console.error);
```

### Complete event source example

See the Stellar blocks example in the Event Sources section above for a complete real-world event source implementation.

## Architecture

### Client architecture

```
WorkflowEngineClient (Public API)
    ↓
HandlerRuntime (Connection Management)
    ↓
WebSocket Connection
    ↓
Workflow Engine
```

### Handler execution flow

```
1. Workflow Engine sends WSHandleTransactions
2. HandlerRuntime routes to registered handler
3. Handler processes transactions
4. Handler returns WSHandleTransactionsResult with results
5. Runtime sends reply back to engine
6. Engine updates workflow state
```

### Event source flow

```
1. Engine sends WSListenerPollRequest
2. HandlerRuntime routes to event source
3. Event source polls external system
4. Event source returns events + checkpoint
5. Engine processes events
6. Engine triggers workflows matching topics
7. Engine saves checkpoint
```

## Advanced topics

### Custom authentication

```typescript
const client = new WorkflowEngineClient({
  url: 'ws://localhost:5503/ws',
  providerName: 'my-service',
  options: {
    headers: {
      'Authorization': `Bearer ${process.env.AUTH_TOKEN}`
    }
  }
});
```

### Multiple handlers

```typescript
// Register multiple handlers
client.registerTransactionHandler('handler1', handler1);
client.registerTransactionHandler('handler2', handler2);
client.registerEventSource('source1', source1);
client.registerEventSource('source2', source2);

// All handlers use the same WebSocket connection
await client.connect();
```

### Configuration validation

```typescript
import { ConfigLoader, WorkflowEngineConfig } from '@kaleido-io/workflow-engine-sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

try {
  // Your application loads config
  const configFile = fs.readFileSync('./config.yaml', 'utf8');
  const config: WorkflowEngineConfig = yaml.load(configFile) as WorkflowEngineConfig;
  
  // Validate required fields
  if (!config.workflowEngine) {
    throw new Error('Missing workflowEngine configuration');
  }
  if (!config.workflowEngine.url) {
    throw new Error('Missing workflowEngine.url');
  }
  if (!config.workflowEngine.auth) {
    throw new Error('Missing workflowEngine.auth');
  }
  
  // SDK logs summary (without sensitive data)
  ConfigLoader.logConfigSummary(config);
} catch (error) {
  console.error('Invalid configuration:', error.message);
  process.exit(1);
}
```

## Best practices

1. **Use the factory pattern**: `newDirectedTransactionHandler` and `newEventSource` provide clean, type-safe APIs
2. **Handle errors gracefully**: Return appropriate `EvalResult` values
3. **Use state updates**: Keep workflow state synchronized with JSON Patch
4. **Implement idempotency**: Event sources should use checkpoints for resumability
5. **Log structured data**: Use the built-in logger with metadata
6. **Test thoroughly**: Unit test handlers, component test with real engine
7. **Monitor connections**: Check `isConnected()` and handle reconnection
8. **Clean up resources**: Implement `withCloseFn` for proper cleanup

## Troubleshooting

### Handler not registered

**Problem**: `No connections for handler 'my-handler'`

**Solution**: Ensure handler is registered before creating workflow or ensure connector is running

```typescript
// Register BEFORE submitting workflows
client.registerTransactionHandler('my-handler', handler);
await client.connect();
// Now workflows can use this handler
```

### Connection timeouts

**Problem**: Client fails to connect or times out

**Solution**: Check workflow engine URL and authentication

```typescript
// Verify URL format (should include ws:// or wss://)
url: 'ws://localhost:5503/ws'  // ✓ Correct
url: 'localhost:5503'           // ✗ Wrong

// Check authentication
authToken: process.env.AUTH_TOKEN  // Ensure token is valid
```

### Event source not polling

**Problem**: Event stream created but no events emitted

**Solution**: 
1. Check stream is started: `"started": true`
2. Verify handler name matches: `listenerHandler: 'my-event-source'`
3. Check provider name matches: `listenerHandlerProvider: 'my-service'`
4. Ensure event source is registered before creating stream

### State Updates Not Applied

**Problem**: JSON Patch operations fail silently

**Solution**: Ensure paths are valid and operations are correct

```typescript
// Use helper functions
Patch.add('/newField', value)      // ✓ Correct
{ op: 'add', path: '/newField' }  // ✗ Missing value

// Array append
Patch.add('/array/-', item)        // ✓ Correct
Patch.add('/array/999', item)      // ✗ Wrong index
```

## API reference

See the TypeScript type definitions for complete API documentation:

- `WorkflowEngineClient` - Main client class
- `WorkflowEngineConfig` - Configuration interface
- `ConfigLoader` - Configuration transformation utilities
- `TransactionHandler` - Handler interface
- `EventSource` - Event source interface
- `EngineAPI` - Engine API interface
- `EvalResult` - Result enum
- `InvocationMode` - Invocation mode enum
- `Patch` - JSON Patch helpers

### ConfigLoader

The `ConfigLoader` class provides utilities for transforming configuration:

- `createClientConfig(config, providerName)` - Transforms `WorkflowEngineConfig` into `WorkflowEngineClientConfig`
  - Converts HTTP URLs to WebSocket URLs
  - Sets up authentication headers based on auth type
  - Handles retry and timeout settings
- `logConfigSummary(config)` - Logs configuration summary (without sensitive data)

**Note:** The SDK does not load configuration from files. Your application should load configuration and pass it to these utilities.
