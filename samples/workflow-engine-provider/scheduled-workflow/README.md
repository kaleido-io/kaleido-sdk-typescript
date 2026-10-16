# Scheduled workflow sample

This example runs a workflow on a schedule. An event source emits one event per interval, and a stream turns each event into a transaction.

## Overview

The sample consists of four components:

1. **Event source** (`scheduled-source.ts`) - Emits one event each interval
2. **Workflow stream** (`stream.ts`) - Starts a `hello-flow` transaction for each event, using the engine's `transaction_dispatch` processor
3. **Event processor** (`echo-processor.ts`) - Logs every event it receives
4. **Echo stream** (`echo-stream.ts`) - Sends each event to the echo processor instead

## How it works

### Event source

The stream config's `intervalMs` sets the interval, and defaults to 60 seconds. The first event fires one interval after the stream is created. If intervals are missed, for example while the provider is down, the next poll emits a single event rather than a backlog.

Each event's idempotency key includes the stream ID, so two streams using the same source never collide. To change what each event carries, edit `buildEvent`. It can be async, for example to call an API.

### Workflow stream

`stream.ts` starts a transaction of the `hello-flow` workflow, from the [hello](../hello/README.md) sample, every five minutes. The `jsonata` mapping builds the transaction input from the event. No handler code is needed on the processing side.

### Echo stream

`echo-stream.ts` sends the same events to the `echo` event processor every ten seconds, which logs them.

## Usage

1. Register the event source and event processor on your client (see `connect.ts`):
   ```typescript
   const app = WorkflowEngineClient.fromConfigFile()
     .eventSource(scheduledSource)
     .eventProcessor('echo', echoProcessor);

   await app.start(); // registers the provider and handlers with the workflow engine
   ```

2. Post the hello workflow, then the stream:
   ```bash
   npm run create-workflow hello/flow.ts
   npm run create-stream scheduled-workflow/stream.ts
   ```

   To see the raw events instead, post `scheduled-workflow/echo-stream.ts`.

## In a TypeScript provider

The source depends only on `@kaleido-io/workflow-engine-sdk` and `@kaleido-io/core-sdk`, so `scheduled-source.ts` can be uploaded unchanged as a TypeScript provider snippet and listed under `eventSources` in the service config. The stream's `handler.name` must match the name in that config. `echo-processor.ts` can be uploaded the same way and listed under `eventProcessors`.
