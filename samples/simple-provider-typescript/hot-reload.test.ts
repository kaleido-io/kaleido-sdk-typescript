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

import { describe, it, expect, afterEach } from 'vitest';
import { isHotReloadEnabled } from './hot-reload';

describe('isHotReloadEnabled', () => {
  const original = process.env.HOT_RELOAD;
  const originalArgv = process.argv[1];

  afterEach(() => {
    if (original === undefined) {
      delete process.env.HOT_RELOAD;
    } else {
      process.env.HOT_RELOAD = original;
    }
    process.argv[1] = originalArgv;
  });

  it('is on when HOT_RELOAD=true', () => {
    process.env.HOT_RELOAD = 'true';
    expect(isHotReloadEnabled()).toBe(true);
  });

  it('is off when HOT_RELOAD=false', () => {
    process.env.HOT_RELOAD = 'false';
    expect(isHotReloadEnabled()).toBe(false);
  });

  it('defaults on for tsx entrypoints', () => {
    delete process.env.HOT_RELOAD;
    process.argv[1] = '/app/connect.ts';
    expect(isHotReloadEnabled()).toBe(true);
  });

  it('defaults off for compiled entrypoints', () => {
    delete process.env.HOT_RELOAD;
    process.argv[1] = '/app/dist/connect.js';
    expect(isHotReloadEnabled()).toBe(false);
  });
});
