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

import { describe, expect, it } from 'vitest';
import { EvalResult } from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';
import { helloHandler } from '../src/transaction/hello.js';

describe('hello', () => {
  it('greets by name and emits a greeting event', async () => {
    const result = await invokeAction(helloHandler, 'hello', { name: 'Ada' }, { transaction: { idempotencyKey: 'txn-1' } });
    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ greeting: 'Hello Ada!' });
    expect(result.events).toEqual([{ idempotencyKey: 'txn-1', topic: 'greeting', data: 'Hello Ada!' }]);
  });

  it('fails the stage without a name', async () => {
    const result = await invokeAction(helloHandler, 'hello', {});
    expect(result.result).toBe(EvalResult.HARD_FAILURE);
    expect(result.error?.message).toBe('name is required');
  });
});
