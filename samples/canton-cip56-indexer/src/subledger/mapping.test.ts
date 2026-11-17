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
import { factsOfLabels, labelsOfFacts, partyName, segment, stateName, contractsToLookUp } from './mapping.js';
import { ADMIN, ALICE, archive, holding, makeEvent } from '../canton/test-helpers.js';

describe('names', () => {
  it('a Canton contract id becomes its 66-char discriminator prefix', () => {
    const cid = '00' + 'ab'.repeat(32) + 'ca'.repeat(36);
    expect(cid).toHaveLength(138);
    expect(stateName(cid)).toBe(cid.slice(0, 66));
    expect(stateName('contract-1')).toBe('contract-1');
  });
  it('a party id becomes a URN-safe name', () => {
    expect(partyName('issuer-001::1220abc')).toBe('issuer-001-1220abc');
    expect(segment('x'.repeat(200))).toHaveLength(64); // sha256
  });
});

describe('facts', () => {
  it('a holding round-trips through its State labels', () => {
    const f = { kind: 'holding' as const, owner: ALICE, admin: ADMIN, instrumentId: 'TOK1', amount: '5.5', locked: true };
    expect(factsOfLabels(labelsOfFacts(f))).toEqual(f);
    expect(factsOfLabels({ template: 'Other' })).toBeUndefined();
  });
});

describe('contractsToLookUp', () => {
  it('only archives of contracts created before the batch', () => {
    const updates = [{
      eventType: 'update' as const, offset: 1, updateId: 'u', transactionId: 't',
      events: [holding('a', ALICE, '1'), archive('a'), archive('b', { choice: 'X' }), makeEvent({ contractId: 'c', eventType: 'exercised', consuming: false })],
    }];
    expect(contractsToLookUp(updates as never)).toEqual(['b']);
  });
});
