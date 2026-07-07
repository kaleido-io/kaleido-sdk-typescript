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

import { describe, it, expect } from 'vitest';
import { EvalResult, WSEvaluateTransaction } from '@kaleido-io/workflow-engine-sdk';
import { actionMap } from './hello';

describe('hello handler', () => {
  it('returns a greeting when name is provided', async () => {
    const handler = actionMap.get('hello');
    expect(handler?.handler).toBeDefined();

    const result = await handler!.handler!(
      {
        state: { input: { name: 'World' } },
      } as WSEvaluateTransaction,
      {} as any,
    );

    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ greeting: 'Hello World!' });
  });

  it('returns HARD_FAILURE when name is missing', async () => {
    const handler = actionMap.get('hello');

    const result = await handler!.handler!(
      { state: { input: {} } } as WSEvaluateTransaction,
      {} as any,
    );

    expect(result.result).toBe(EvalResult.HARD_FAILURE);
    expect(result.error?.message).toBe('name is required');
  });
});
