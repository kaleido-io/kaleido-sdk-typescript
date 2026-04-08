# Samples

Samples live inside the SDK package so they are distributed with `npm publish`
and available to the `wesdk init --sample` CLI.

Browse them at:
[`packages/workflow-engine-sdk/samples/`](../packages/workflow-engine-sdk/samples/)

## Using a sample

```bash
npx @kaleido-io/workflow-engine-sdk init my-provider --sample erc20-indexer
cd my-provider
npm install
# edit config/ files, then:
npm run start:dev
```
