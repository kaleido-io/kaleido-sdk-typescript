# Custom handler implementations

Each `.ts` file listed in `config/provider-config.json` exports a handler for its type.

## Transaction handler

Export `actionMap`:

```typescript
import {
  EvalResult,
  InvocationMode,
  WSEvaluateTransaction,
  type ActionConfig,
} from '@kaleido-io/workflow-engine-sdk';

export const actionMap = new Map<string, ActionConfig<any>>([
  [
    'my-action',
    {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction) => ({
        result: EvalResult.COMPLETE,
        output: { /* ... */ },
      }),
    },
  ],
]);
```

Config: `transactionHandlers` — `name` is the provider handler name; `actionMap` keys are stage-director actions.

See `hello.ts`.

## Event source

Export `eventSource` from `createEventSource()`. The `name` passed to `createEventSource` must match the config `name`:

```typescript
import { createEventSource } from '@kaleido-io/workflow-engine-sdk';

export const eventSource = createEventSource('my-listener', async (config, checkpoint) => ({
  checkpointOut: { /* ... */ },
  events: [/* ... */],
}));
```

Config: `eventSources`

See `tick-source.ts`.

## Event processor

Export a `processBatch` function. Config owns the handler name; the provider registers it with `.eventProcessor(name, { processBatch })`:

```typescript
import type { EventProcessorDef } from '@kaleido-io/workflow-engine-sdk';
import { newLogger } from '@kaleido-io/core-sdk/log';

export const processBatch: EventProcessorDef['processBatch'] = async (_ctx, events) => {
  for (const event of events) {
    // process event
  }
};
```

Config: `eventProcessors`

See `echo-processor.ts`.

## Hosted runtimes

For read-only filesystems, prefer mounting compiled `.js` files. Use `import type` for type-only SDK imports when loading `.ts` without a transpiler.
