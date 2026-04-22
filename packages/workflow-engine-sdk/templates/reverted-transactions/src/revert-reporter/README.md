# Revert reporter sample

This example demonstrates how to set up a stream of reverted EVM transaction events and send them to a custom event processor.

## Overview

The event source sample consists of two main components:

1. **Event Processor** (`event-processor.ts`) - Logs out any events it receives
2. **Event stream** (`stream.ts`) - Connects the event source to the event processor

The blockchain node being used by the EVM connector must support trace APIs to allow for address-based transaction filtering.

Additionally, for the errors to be decoded using the ABI, the `revertReason` will need to be populated. How to enable this is client-specific. For example, to enable this on Besu, use the `--revert-reason-enabled` CLI flag.

## How it works

### Stream

The stream uses the EVM connector evmTransactions event source, configured to filter to a given set of addresses. It filters any events on `receipt.status` to return only errored transactions, before passing them on to the event processor.event processor is part of the same provider, but this is not a requirement.

### Event processor

The event processor (`event-processor.ts`) listens for batches of events and logs them out as they are received. It then updates the checkpoint to acknowledge the events have been processed.

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
