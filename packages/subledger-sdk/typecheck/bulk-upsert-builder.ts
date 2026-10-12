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

// Calls that must not compile. Checked by `npm run typecheck`, never run.

import type { BulkUpsertBuilder } from "../src/bulk-upsert-builder.js";

declare const b: BulkUpsertBuilder;
const usd = { name: "USD", decimals: 2 };

// @ts-expect-error scoped section without a root
b.lifecycle.add({ steps: [{ items: [{ transactionUrn: "tx1", name: "s" }] }] });
// @ts-expect-error unscoped section with a root
b.registry.add({ assets: { bookUrn: "x", items: [usd] } });
// @ts-expect-error item type follows the section
b.registry.add({ assets: { items: [{ idempotencyKey: "k" }] } });
// @ts-expect-error settings belong in defaults or configure
b.registry.add({ assets: { updateStrategy: "create_only", items: [usd] } });
