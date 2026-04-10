# Snap handler sample

This example demonstrates how to set up a transaction handler that uses event triggers to wait for and respond to external events, implementing a "snap" card game mechanic. It showcases the use of a **correlation stream** to match events from any event source with inflight transactions.

## Overview

The snap handler sample consists of four main components:

1. **Transaction handler** (`snap-handler.ts`) - Implements a card game "snap" mechanic with three actions
2. **Event source** (`event-source.ts`) - Acts as a card dealer, dealing cards from a shuffled deck
3. **Correlation stream** (`stream.ts`) - Connects events from the event source to inflight transactions
4. **Workflow** (`flow.ts`) - Defines the workflow stages and event bindings

## How it works

### The snap game flow

The snap game works by setting a "trap" for a specific playing card (suit and rank) and waiting for that card to be dealt. Here's how the complete flow works:

1. **Transaction Creation**: A transaction is created with a suit and rank (e.g., "hearts" and "king")
2. **Trap Setup**: The transaction handler sets up a trigger for that specific card
3. **Waiting State**: The transaction enters a waiting state, listening for matching events
4. **Card Dealing**: The event source (dealer) deals cards from a shuffled deck
5. **Event Correlation**: The correlation stream receives card events and determines if they match any inflight transactions
6. **Match Detection**: When a matching card is dealt, the stream adds a transaction event to the database
7. **Handler Invocation**: The transaction handler is invoked with the matching event, completing the "snap"

### Transaction handler

The snap handler (`snap-handler.ts`) implements a card game where you can "set a trap" for a specific playing card (suit and rank) and wait for that card to be played. The handler has three actions:

1. **`set-trap`** - Sets up a trigger for a specific card by creating an event topic based on the suit and rank (e.g., `suit.hearts.rank.king`)
2. **`trap-set`** - Marks that the trap is active and waits for the matching card to be played
3. **`trap-fired`** - Handles when a matching card is played via an event, completing the "snap" and returning the card data

### Event source

The event source (`event-source.ts`) acts as a card dealer that generates card play events. It maintains a shuffled deck of 52 playing cards and deals random batches of cards (1-9 cards per poll) when polled by the workflow engine. Each card dealt generates an event with:

- A topic matching the pattern `suit.<suit>.rank.<rank>` (e.g., `suit.hearts.rank.king`)
- A data payload containing the card's description, suit, and rank
- A unique idempotency key

The event source tracks how many cards have been dealt and stops generating events when the deck is exhausted.

### Correlation stream

The correlation stream (`stream.ts`) is a key component that demonstrates how events from any event source can be correlated with inflight transactions. The stream:

- **Type**: `correlation_stream` - This type of stream evaluates events against all inflight transactions
- **Event source**: Connects to the `snap-dealer` event source to receive card events
- **Matching Logic**: When a card event is received, the workflow engine checks if any inflight transactions have event listeners that match the event's topic pattern
- **Transaction Event**: If a match is found, the engine adds a transaction event to the database and invokes the corresponding transaction handler

This is different from an `event_stream`, which routes events to event processors. A correlation stream allows transactions to wait for and respond to events from any source, making it ideal for event-driven workflows where transactions need to react to external events.

### Workflow

The workflow (`flow.ts`) defines the stages and event bindings:

- **`set-trap` stage**: Initializes the trap by calling the `set-trap` action
- **`trap-set` stage**: Confirms the trap is set and enters a waiting state
- **Event listener**: Listens for card play events matching the pattern `suit.<suit>.rank.<rank>`
- **`snap` stage**: Final success stage reached when the matching card is played

When the correlation stream receives a card event that matches an inflight transaction's event listener, the workflow engine automatically adds the event to that transaction and invokes the handler, causing the workflow to transition to the `snap` stage.

## Usage

1. Register the snap handler in your provider's main file:
   ```typescript
   const snapHandler = newDirectedTransactionHandler('snap-watcher', snapActionMap);
   client.registerTransactionHandler('snap-watcher', snapHandler);
   ```

2. Register the dealer event source:
   ```typescript
   client.registerEventSource('snap-dealer', dealerEventSource);
   ```

3. Start your application to register your provider and handlers with the workflow engine.

4. Post the workflow to the workflow engine using the utility scripts:
   ```bash
   npm run create-workflow src/samples/snap/flow.ts
   ```

5. Post the correlation stream to connect the dealer event source to the workflow engine:
   ```bash
   npm run create-stream src/samples/snap/stream.ts
   ```

6. Create a transaction with a suit and rank to set a trap:
   ```bash
   npm run create-transaction src/samples/snap/transaction.json
   ```

Once configured, the event source will deal cards from a shuffled deck. The correlation stream will evaluate each card event against all inflight transactions. When a card matching a transaction's trap is dealt, the stream will add the event to that transaction, causing the handler to be invoked and the workflow to transition to the `snap` stage, completing the transaction.
