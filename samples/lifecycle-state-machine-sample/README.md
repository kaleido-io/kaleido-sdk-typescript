# Lifecycle state machine sample

A workflow engine event processor that drives payment transactions with a `@kaleido-io/subledger-sdk/state-machine` handler.

- `src/payment.ts` defines the machine. Its states are facts about the payment: `accepted`, then `settled` or `failed`. Entering `accepted` adds the `reserve` step; a completed `reserve` adds the `settle` step, and a completed `settle` makes the payment `settled`. A failed step, caught by the machine's own `step-outcome.*` transition, makes it `failed`. Entering a final state concludes the payment.
- `src/main.ts` registers an event processor on the transaction type's `lifecycle.events` stream and runs each batch through `handleEvents`.

The workflows that carry out `reserve` and `settle` are outside this sample.

## Running

1. Copy `config/config.sample.yaml` to `config/config.yaml` and fill in the workflow engine and subledger endpoints.
2. `npm run build`, then `npm start`.
