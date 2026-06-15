# Design Documentation TODOs

Items to document once the API stabilises.

## Samples

- Add a coin-selector extension to `samples/btc-indexer` that demonstrates the indexer-with-txnhandler pattern: a second class (e.g. `BTCIndexerWithCoinSelector`) that extends `BTCIndexer`, adds a coin-selection action map that reads from the indexed fragment state, and registers both the indexer and the transaction handler on the same `WorkflowEngineClient` in `main.ts`.

## Config

- Document the two-file config split: `KALEIDO_CONFIG_FILE` (operator-managed, workflow-engine + service-bindings) vs `CONFIG_FILE` (developer-managed, provider-specific config).
- Document how consumers extend a sample's config type to add their own fields: extend the base config interface, pass the extended type to `WorkflowEngineClient.fromConfigFile<MyConfig>()`, and either subclass the indexer or wrap it inline.
