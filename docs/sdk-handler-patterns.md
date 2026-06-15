# SDK Handler Patterns in the TypeScript Ecosystem

How do major TypeScript SDKs solve the problem of getting configured service clients into user-written business logic? This document surveys the major patterns as reference for the Kaleido SDK design.

---

## AWS Lambda + SDK v3

**Pattern: Global client scope + single exported handler function**

Config comes from the environment. Clients are created once at module scope (cold start). The framework calls the exported `handler` function; the user closes over pre-built clients.

```typescript
import { S3Event } from "aws-lambda";
import { RekognitionClient, DetectLabelsCommand } from "@aws-sdk/client-rekognition";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// Clients created once at cold start — implicit config from environment
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

// User writes one function — framework calls it
export const handler = async (event: S3Event): Promise<void> => {
  const key = event.Records[0].s3.object.key;
  const { Labels } = await rekognition.send(new DetectLabelsCommand({ Image: { S3Object: { Bucket: '...', Name: key } } }));
  await dynamo.send(new PutCommand({ TableName: 'ImageMetadata', Item: { key, labels: Labels } }));
};
```

**What the framework handles:** invocation, retries, scaling, error reporting  
**What the user handles:** client instantiation, config wiring  
**Service injection:** closure over module-scoped variables  
**Config:** environment variables, implicit

---

## Cloudflare Workers

**Pattern: `env` bindings injected as a handler parameter**

Platform-managed service bindings (KV, D1, queues, etc.) are declared in config (`wrangler.toml`) and injected as typed `env` at invocation time. The user never constructs clients — they receive ready-to-use bindings.

```typescript
interface Env {
  DB: D1Database;       // D1 SQL binding
  CACHE: KVNamespace;   // KV store binding
  QUEUE: Queue;         // Queue binding
}

// Framework injects env — user writes one function
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    await env.CACHE.put(`user:${id}`, JSON.stringify(user));
    return Response.json(user);
  }
};
```

**What the framework handles:** client construction, connection lifecycle, config  
**What the user handles:** nothing — bindings arrive pre-configured  
**Service injection:** typed `env` parameter  
**Config:** `wrangler.toml` binding declarations, resolved by platform

This is the closest analogue to the hosted/non-hosted service binding concept in Kaleido. The user declares what services they need; the platform provides them.

---

## BullMQ

**Pattern: Worker constructor with a single async job handler**

Queue name + connection config go to the `Worker` constructor. The user provides one function that receives the job. No client construction inside the handler.

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(
  'image-processing',
  async (job: Job<{ imageUrl: string }>) => {
    // business logic only — connection managed by Worker
    const result = await processImage(job.data.imageUrl);
    return result;
  },
  { connection: { host: 'localhost', port: 6379 } }
);
```

For multiple job types, a single handler dispatches by `job.name`:

```typescript
const worker = new Worker('tasks', async (job) => {
  switch (job.name) {
    case 'resize':   return await resize(job.data);
    case 'compress': return await compress(job.data);
  }
});
```

**What the framework handles:** connection, polling, concurrency, ack/nack, retries  
**What the user handles:** nothing beyond the function  
**Service injection:** job data only; external clients closed over from outer scope  
**Config:** constructor params

The single-constructor, single-function pattern is highly idiomatic for queue-style processing in TS.

---

## tRPC

**Pattern: Procedure builder with `ctx` injection**

A shared `context` object is constructed once per request by a user-defined `createContext` function. Procedures receive `ctx` as a typed parameter — they never construct clients directly.

```typescript
import { initTRPC } from '@trpc/server';

// 1. Define what's in context — created once per request
const createContext = async () => ({
  db: new PrismaClient(),
  user: await getCurrentUser(),
});

const t = initTRPC.context<typeof createContext>().create();

// 2. User writes procedures — ctx is pre-built and typed
const appRouter = t.router({
  userById: t.procedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findUnique({ where: { id: input } });
    }),

  createPost: t.procedure
    .input(z.object({ title: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.post.create({ data: { title: input.title, authorId: ctx.user.id } });
    }),
});
```

**What the framework handles:** routing, serialisation, type inference end-to-end  
**What the user handles:** defining `createContext`; writing procedures  
**Service injection:** `ctx` parameter, fully typed  
**Config:** `createContext` is user-defined — any config strategy works

The `ctx` pattern is the most influential in modern TS: it is explicit, typed, and separates "how clients are built" (context factory) from "how they are used" (procedure body).

---

## Temporal

**Pattern: Activity/workflow separation — workflow code calls named activities**

Workflows are pure coordination logic. Activities are where side effects (API calls, DB writes) happen. The worker registers both and the runtime calls them. Config and clients live in the activity layer; workflow code never sees them.

```typescript
// activities.ts — side effects, clients constructed here
import { createActivityHandle } from '@temporalio/activity';

const db = new DatabaseClient(process.env.DB_URL);
const stripe = new Stripe(process.env.STRIPE_KEY);

export async function chargeCustomer(customerId: string, amount: number): Promise<string> {
  const charge = await stripe.charges.create({ amount, customer: customerId });
  await db.save({ customerId, chargeId: charge.id });
  return charge.id;
}

// workflow.ts — pure coordination, no service clients
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { chargeCustomer, sendReceipt } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export async function paymentWorkflow(customerId: string, amount: number): Promise<void> {
  const chargeId = await chargeCustomer(customerId, amount);
  await sendReceipt(customerId, chargeId);
}

// worker.ts — registers both and starts processing
const worker = await Worker.create({
  workflowsPath: require.resolve('./workflow'),
  activities,
  taskQueue: 'payments',
  connection: await NativeConnection.connect({ address: 'temporal:7233' }),
});
await worker.run();
```

**What the framework handles:** worker lifecycle, retry policies, durability, scheduling  
**What the user handles:** activity implementation; workflow coordination logic  
**Service injection:** module-scope clients closed over in activity functions  
**Config:** worker constructor; activities are plain functions

This is the most structurally similar to Kaleido WFE: workflows = WFE transaction workflows, activities = transaction handler actions, worker = provider/app. The separation between "coordination" (workflow) and "side effects" (activity) maps directly to WFE's transaction handler model.

---

## Summary

| Library | Config source | Client construction | Injection mechanism | User writes |
|---|---|---|---|---|
| AWS Lambda | Environment vars | Module scope (cold start) | Closure | One `handler` function |
| Cloudflare Workers | `wrangler.toml` bindings | Platform-managed | Typed `env` param | One `fetch` function |
| BullMQ | Constructor params | Constructor | Closure over outer scope | One job handler function |
| tRPC | `createContext` factory | Context factory | Typed `ctx` param | Procedure bodies |
| Temporal | Worker constructor | Activity module scope | Closure in activities | Activity functions + workflow |

### Key observations

1. **The user should write one function.** Every library above converges on this. Config, connection lifecycle, and client wiring are the framework's job.

2. **`ctx`/`env` injection is the modern pattern.** Cloudflare and tRPC both inject a typed context rather than requiring the user to construct or import clients. This keeps handler code portable and testable.

3. **Module-scope clients are the fallback.** Lambda and Temporal use closure over module-scoped clients when the framework doesn't provide injection. It works but couples config to the handler file.

4. **Temporal's activity/workflow split is the closest analogue to WFE.** The separation of coordination (workflow) from side effects (activity/handler) is the same conceptual model. The `Worker` registering multiple activity functions maps directly to registering multiple WFE handlers.

5. **Config is always external to the handler.** No pattern has the user build config objects inside their handler function. Config either comes from environment (Lambda), platform bindings (Cloudflare), or a constructor (BullMQ, Temporal).

---

## Comparison against Kaleido SDK requirements

Kaleido-specific requirements:
- **Multiple handler types** — event processors (indexers) and transaction handlers may coexist in one process
- **Hosted ↔ non-hosted transparency** — same handler code must work whether services are accessed via WS proxy (inside platform) or direct HTTP (outside)
- **Non-WFE consumers** — some users just need an AM client with no WFE connection at all
- **Stream lifecycle** — streams may need to be created/upserted before handlers start processing
- **WFE concept visibility** — users should understand they are writing event processors and transaction handlers, not just generic functions
- **Testability** — handler business logic should be testable without a live WFE or platform connection
- **Init/runtime separation** — stream creation may need to run as a separate migration step

| Requirement | AWS Lambda | Cloudflare Workers | BullMQ | tRPC | Temporal |
|---|---|---|---|---|---|
| Multiple handler types in one process | ✗ one export per function | ✗ one `fetch` per worker | ~ multiple Worker instances | ✓ router composes procedures | ✓ worker registers N activities |
| Hosted ↔ non-hosted transparency | ✗ env vars only | ✓ binding type is config, code unchanged | ✗ manual switching | ~ handled in `createContext` | ✗ manual switching |
| Non-WFE consumers (AM standalone) | ✓ clients work outside any framework | ✓ bindings work standalone | ✓ queue worker is optional | ✓ context works standalone | ✗ activities need a worker |
| Stream/resource lifecycle (pre-start setup) | ✗ no lifecycle hooks | ✗ no pre-start hook | ✗ no pre-start hook | ✗ no pre-start hook | ~ worker `onCreate`; limited |
| WFE concept visibility | ✗ no mapping | ✗ no mapping | ~ job/queue maps loosely | ✗ no mapping | ✓ workflow/activity maps directly |
| Testability of handler logic | ~ clients must be mocked at module scope | ✓ inject mock `env` | ~ close over mock clients | ✓ inject mock `ctx` | ✓ activities are plain functions |
| Init/runtime separation | ✗ no built-in | ✗ no built-in | ✗ no built-in | ✗ no built-in | ~ separate worker setup possible |

### Conclusions for Kaleido SDK design

No single pattern covers all requirements. The ideal design borrows from three:

1. **From Temporal** — a `Worker`-equivalent (`KaleidoApp`) that registers multiple named handlers and owns the connection lifecycle. This makes WFE concepts (event processor, transaction handler) explicit and maps to how other WFE SDK implementations (Go, Java) will naturally express the same idea.

2. **From Cloudflare Workers / tRPC** — a typed `ctx` injected into every handler function, pre-populated with configured service clients. The `ctx` resolves hosted vs non-hosted transparently — handlers never construct or import clients directly. This is also what makes handler logic testable: inject a mock `ctx`.

3. **From BullMQ** — the minimal surface area: `KaleidoApp.fromConfigFile().indexer('name', async (ctx, events) => { ... }).start()`. One function, no boilerplate, framework handles everything else.

**Stream/resource lifecycle** has no good analogue in any of the surveyed libraries. The right model is a generic `setup` lifecycle hook that `KaleidoApp` calls on every registered handler before connecting to WFE. What the handler does inside that hook is its own concern:

```typescript
// Indexer uses the hook to ensure its stream exists
await KaleidoApp.fromConfigFile()
    .indexer('btc-indexer', {
        setup: async (ctx) => {
            await ensureStream(ctx, { factory: '...', name: 'btc-mainnet', eventSourceConfig: { ... } });
        },
        process: async (ctx, events) => { ... },
    })
    .start();

// A key manager handler uses the same hook for a completely different concern
await KaleidoApp.fromConfigFile()
    .transactionHandler('key-manager', {
        setup: async (ctx) => {
            await ensureKeyStore(ctx, { ... });
        },
        actions: { ... },
    })
    .start();
```

`ensureStream`, `ensureKeyStore`, etc. are utility functions exported by their respective packages — not methods on `KaleidoApp`. `KaleidoApp` only knows about the generic `setup` hook; it has no knowledge of streams, key stores, or any other handler-specific resource. This keeps `KaleidoApp` stable as new handler types are introduced.

For cases where setup needs to run as a separate migration step (init container, deployment pipeline), `KaleidoApp` exposes a `.setup()` method that runs all handler setup hooks and exits without connecting to WFE:

```typescript
// Separate init step — runs setup hooks only, then exits
await KaleidoApp.fromConfigFile()
    .indexer('btc-indexer', { setup: async (ctx) => { ... }, process: async (ctx, events) => { ... } })
    .setup();

// Normal runtime — runs setup hooks then connects
await KaleidoApp.fromConfigFile()
    .indexer('btc-indexer', { setup: async (ctx) => { ... }, process: async (ctx, events) => { ... } })
    .start();
```
