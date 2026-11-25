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
  go,
  ifFailed,
  stateMachine,
} from "@kaleido-io/subledger-sdk/state-machine";

/**
 * A simple payment lifecycle. Each state is a fact about the payment. In
 * `accepted` the payment runs the reserve step, then the settle step, and
 * then becomes settled. Any failed step makes it failed. Entering either
 * final state concludes the payment.
 */
export const payment = stateMachine({
  initial: go("accepted"),
  states: {
    accepted: {
      steps: ["reserve", "settle"],
      then: go("settled"),
    },
    settled: { type: "final", outcome: "completed" },
    failed: { type: "final", outcome: "failed" },
  },
  on: {
    "step-outcome.*": ifFailed({
      run: (_ctx, { transaction, event }) => {
        const step = transaction.steps?.find((s) => s.urn === event.subjectUrn);
        return go("failed", { error: `${step?.name} failed` });
      },
      to: ["failed"],
    }),
  },
});
