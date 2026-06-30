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

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'src/index': 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep npm packages and the published @kaleido-io/* service SDKs external —
  // they are real runtime dependencies. Bundle @kaleido-io/core inline so the
  // types/utilities it provides are erased at compile time rather than becoming
  // a runtime dependency (matching workflow-engine-sdk / asset-manager-sdk).
  external: [/^[^./]/],
  noExternal: ['@kaleido-io/core'],
});
