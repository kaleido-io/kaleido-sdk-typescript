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
import { handleTICreated } from './ti-processor.js';
import type { TransferData } from '../types.js';
import { makeEvent, makeBatchContext } from '../test-helpers.js';

describe('handleTICreated', () => {
  it('creates fragment with sender, receiver, and amount labels', () => {
    const ce = makeEvent({ contractId: 'ti-1' });
    const td: TransferData = {
      sender: 'alice::fp1',
      receiver: 'bob::fp2',
      amount: '42.5',
      instrumentId: { admin: 'bank::fp3', id: 'TestInstId' },
    };
    const ctx = makeBatchContext();

    handleTICreated(ce, td, ctx);

    expect(ctx.fragmentMap.size).toBe(1);
    const frag = ctx.fragmentMap.get('alice::fp1/ti-1');
    expect(frag).toMatchObject({
      name: 'ti-1',
      address: 'alice::fp1',
      value: '425000000000',
      displayName: 'TransferInstruction 42.5 TestInstId',
      labels: expect.objectContaining({
        chain: 'canton',
        standard: 'CIP-56',
        type: 'transfer_instruction',
        sender: 'alice::fp1',
        receiver: 'bob::fp2',
        instrumentId: 'TestInstId',
        admin: 'bank::fp3',
        spent: 'false',
      }),
    });

    expect(ctx.transfers).toHaveLength(0);
    expect(ctx.addressSet.has('alice::fp1')).toBe(true);
    expect(ctx.addressSet.has('bob::fp2')).toBe(true);
  });

  it('falls back to signatories for sender when td.sender is empty', () => {
    const ce = makeEvent({ contractId: 'ti-2', signatories: ['fallback::fp'] });
    const td: TransferData = {
      sender: '',
      receiver: 'bob::fp',
      amount: '10',
    };
    const ctx = makeBatchContext();

    handleTICreated(ce, td, ctx);

    const frag = ctx.fragmentMap.get('fallback::fp/ti-2');
    expect(frag?.address).toBe('fallback::fp');
  });
});
