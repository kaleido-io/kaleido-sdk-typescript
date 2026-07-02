# Hello sample

This example demonstrates a simple transaction handler that processes input data and returns a greeting message.

## Overview

The hello sample consists of two main components:

1. **Handler** (`handlers.ts`) - Processes a name input and returns a personalized greeting
2. **Workflow** (`flow.ts`) - Defines the workflow that invokes the hello handler

## How it works

### Handler

The hello handler (`handlers.ts`) accepts a transaction with a `name` field in the input. It:

- Validates that the `name` field is provided
- Returns a personalized greeting message in the output
- Emits an event with the greeting message to demonstrate event emission from handlers

If the `name` field is missing, the handler returns a hard failure with an error message.

### Workflow

The `hello-flow` workflow (`flow.ts`) defines a simple asynchronous operation that:

- Accepts an input with a required `name` string field
- Invokes the hello handler to process the input
- Returns the greeting message in the output

## Usage

1. Register the hello handler on your client (see `connect.ts`):
   ```typescript
   const app = WorkflowEngineClient.fromConfigFile()
     .transactionHandler('hello', { handler: createTransactionHandler('hello', helloActionMap) });

   await app.start(); // registers the provider and handlers with the workflow engine
   ```

2. Post the workflow to the workflow engine using the utility script:
   ```bash
   npm run create-workflow hello/flow.ts
   ```

3. Create a transaction to test the handler:
   ```bash
   npm run create-transaction hello/transaction.ts
   ```

The handler will process the transaction and return a greeting message. A transaction event will also be created.
