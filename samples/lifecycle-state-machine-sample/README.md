# Lifecycle state machine sample

A workflow engine event processor that drives payment transactions with a `@kaleido-io/subledger-sdk/state-machine` handler.

- `src/payment.ts` defines the machine. Its states are facts about the payment: `accepted`, then `settled` or `failed`. On `transaction-accepted` it adds the `reserve` and `settle` steps to `accepted`, and `autoStartSteps` starts them in turn. A completed `settle` concludes the payment as `settled`; a failed step, caught by the `*` state, makes it `failed`.
- `src/main.ts` registers an event processor on the transaction type's `lifecycle.events` stream and runs each batch through `handleEvents`.

The workflows that carry out `reserve` and `settle` are outside this sample.

## Running

1. Copy `config/config.sample.yaml` to `config/config.yaml` and fill in the workflow engine and subledger endpoints.
2. `npm run build`, then `npm start`.
