# Event source sample

This example demonstrates how to set up a custom event source that generates events and streams them to an event processor.

## Overview

The event source sample consists of three main components:

1. **Event source** (`event-source.ts`) - Generates timestamped events at regular intervals
2. **Event Processor** (`event-processor.ts`) - Logs out any events it receives
3. **Event stream** (`stream.ts`) - Connects the event source to the event processor

## How it works

### Event source

The event source (`event-source.ts`) generates a new timestamped event every ten seconds. When the workflow engine polls for events, the event source checks if more than ten seconds have passed since the last poll time stored in the checkpoint. If so, it generates a new event with:

- A unique idempotency key
- A topic (`my-topic`)
- A data payload containing a message and timestamp

### Stream

When an event is received from the event source, the stream (`stream.ts`) ensures that the event is passed on to the event processor handler. In this scenario, for simplicity, the event processor is part of the same provider, but this is not a requirement.

### Event processor

The event processor (`event-processor.ts`) listens for batches of events and logs them out as they are received. It then updates the checkpoint to acknowledge the event shave been processed.

## Usage

1. Register the event source in your provider's main file:
   ```typescript
   client.registerEventSource('my-listener', eventSource);
   ```

2. Register the event processor:
   ```typescript
   client.registerEventProcessor('echo', echoEventProcessor);
   ```

3. Start your application to register your provider and handlers with the workflow engine.

4. Post the stream to the workflow engine using the utility scripts:
   ```bash
   npm run create-stream src/samples/event-source/stream.ts
   ```

Once configured, the event source will generate events every ten seconds, which will result in the event processor being called.
