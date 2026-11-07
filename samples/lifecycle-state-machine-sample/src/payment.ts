// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  addSteps,
  concludeTransaction,
  go,
  ifCompleted,
  ifFailed,
  stateMachine,
  stay,
} from "@kaleido-io/subledger-sdk/state-machine";

/**
 * A payment's lifecycle. Each state is a fact about the payment. Once it is
 * accepted, it plans its steps, reserve then settle, which the machine
 * starts in turn; a completed settle makes it settled, and any failed step
 * makes it failed.
 */
export const payment = stateMachine({
  initial: "accepted",
  final: ["settled", "failed"],
  options: { autoStartSteps: true },
  states: {
    accepted: {
      steps: ["reserve", "settle"],
      on: {
        "transaction-accepted": {
          to: [],
          run: (ctx, { transaction }) => {
            addSteps(ctx, transaction, [
              { name: "reserve", state: "accepted" },
              { name: "settle", state: "accepted" },
            ]);
            return stay();
          },
        },
        "step-outcome.settle": ifCompleted({
          to: ["settled"],
          run: (ctx, { transaction, event }) => {
            concludeTransaction(ctx, transaction, {
              causationUrn: event.urn,
              status: "completed",
            });
            return go("settled");
          },
        }),
      },
    },
    "*": {
      on: {
        "step-outcome.*": ifFailed({
          to: ["failed"],
          run: (ctx, { transaction, event }) => {
            const step = transaction.steps?.find(
              (s) => s.urn === event.subjectUrn,
            );
            concludeTransaction(ctx, transaction, {
              causationUrn: event.urn,
              status: "failed",
              error: `${step?.name} failed`,
            });
            return go("failed");
          },
        }),
      },
    },
  },
});
