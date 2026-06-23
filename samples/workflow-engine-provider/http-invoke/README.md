# HTTP invoke sample

This example demonstrates how to make HTTP requests to external APIs from within a transaction handler.

## Overview

The http-invoke sample consists of two main components:

1. **Handler** (`handlers.ts`) - Makes an HTTP request to an external API and returns the response
2. **Workflow** (`flow.ts`) - Defines the workflow that invokes the http-invoke handler

## How it works

### Handler

The http-invoke handler (`handlers.ts`) demonstrates a handler making an async request and providing a response to the transaction when the request has completed.

### Workflow

The `http-invoke-flow` workflow (`flow.ts`) is a simple flow that completes once the HTTP response has been returned by the handler.

## Usage

1. Register the http-invoke handler on your client (see `connect.ts`):
   ```typescript
   const app = WorkflowEngineClient.fromConfigFile()
     .transactionHandler('http-invoke', { handler: createTransactionHandler('http-invoke', httpInvokeActionMap) });

   await app.start(); // registers the provider and handlers with the workflow engine
   ```

2. Post the workflow to the workflow engine using the utility script:
   ```bash
   npm run create-workflow http-invoke/flow.ts
   ```

3. Create a transaction to test the handler:
   ```bash
   npm run create-transaction http-invoke/transaction.ts
   ```

The handler will make the HTTP request and return the response.
