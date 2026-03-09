# Kaleido workflow engine custom providers

This project contains worked examples of custom providers that register transaction handlers and event sources with the Kaleido workflow engine.

## Getting started

1. Copy `.env.sample` to `.env` and populate the values. You will need:
   - a Kaleido account in a tenant something of the format <account_name>.<tenant_url>
   - an environment in that account, either name or ID
   - a workflow engine in that environment, either name or ID
   - an API key name and value - the API key will need to be granted service access to the workflow engine
2. Install dependencies: `npm install`
3. Start the provider, either:
   - use the vscode launch configurations to run inside the debugger
   - use `npm run start:dev` to run TypeScript
   - use `npm build` and `npm start` to run transpiled JavaScript

Your provider will initialize and attempt to connect to the workflow engine and register the provider and handlers. You should see:
```bash
[handler_runtime] Registering provider and handlers
```
Followed by some handler registration messages. You can now take a look at your workflow engine provider page in the Kaleido UI and you should see your provider listed.

This project will be bootstrapped with some example handlers, and the flows and streams needed to put them to use. To trigger a handler, you can use the `hello` sample by:
- defining a workflow that uses the `hello` handler by running `npm run create-workflow ./src/samples/hello/flow.ts`
- create a transaction against that workflow by running `npm run create-transaction ./src/samples/hello/transaction.json`

You should see the transaction appear in your workflow engine, and it should transition to `succeeded` shortly afterwars with a greeting message produced by the `hello` handler in this project.

## Included Samples

This project includes several samples demonstrating different patterns and capabilities:

- **[Hello](./src/samples/hello/README.md)** - A simple transaction handler that processes input and returns a greeting message
- **[HTTP invoke](./src/samples/http-invoke/README.md)** - Demonstrates making HTTP requests to external APIs from within a transaction handler
- **[Event source](./src/samples/event-source/README.md)** - Shows how to set up a custom event source that generates events and streams them to an event processor
- **[Snap](./src/samples/snap/README.md)** - By playing the card game "snap", this sample demonstrates a correlation stream that matches events from any event source with inflight transactions.
