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

import * as fs from 'fs';
import * as path from 'path';
import { expect } from '@jest/globals';

const GOLDEN_DIR = path.join(__dirname, 'golden');

// IDs the SDK generates itself, for example `1760620000000-k3j2h1g0f`.
const GENERATED_ID = /^\d{13}-[a-z0-9]+$/;

/** Replace values that differ on every run, so recordings can be compared. */
export function normalise(value: unknown): unknown {
  if (typeof value === 'string') {
    return GENERATED_ID.test(value) ? '<generated-id>' : value;
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

/**
 * Compare a recording with its golden file. Set UPDATE_GOLDEN=1 to write the
 * golden file instead, for an intended and reviewed behaviour change.
 */
export function expectGolden(name: string, recording: unknown): void {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const actual = JSON.parse(JSON.stringify(normalise(recording)));
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Golden file ${file} is missing. Run with UPDATE_GOLDEN=1 to record it.`);
  }
  expect(actual).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
}
