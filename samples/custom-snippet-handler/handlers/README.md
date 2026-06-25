# Custom handler implementations

Each `.ts` file listed in `config/provider-config.yaml` must export an `actionMap`:

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

The `name` in the YAML config is the **provider handler name** registered with the Workflow Engine.
The keys inside `actionMap` are the **actions** routed by the stage director (`action` field in workflow input).

For hosted runtimes (read-only filesystem), prefer mounting compiled `.js` files. If using `.ts`, use `import type` for type-only SDK imports so Node can load the file without a transpiler cache.

See `hello.ts` for a minimal example.
