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

import dotenv from 'dotenv';
import { createConfiguredClient } from './register-handlers.js';
import { isHotReloadEnabled, startWithHotReload } from './hot-reload.js';

dotenv.config();

if (isHotReloadEnabled()) {
  const session = await startWithHotReload();
  process.on('SIGINT', () => session.stop());
  process.on('SIGTERM', () => session.stop());
} else {
  const app = await createConfiguredClient();
  process.on('SIGINT', () => app.stop());
  process.on('SIGTERM', () => app.stop());
  await app.start();
}
