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
import { handleArchived, resolveFromEvent } from './archive-processor.js';
import { makeEvent, makeBatchContext, holdingInterfaceView } from '../test-helpers.js';


describe('handleArchived', () => {
  it('emits subtract transfer and marks spent for holding with amount+pool', () => {
    const ce = makeEvent({ eventType: 'archived', contractId: 'c1', transactionId: 'tx-a' });
    const info = { owner: 'alice::fp', amount: '1000', asset: 'TOK', poolRef: 'bank::fp/TOK' };
    const ctx = makeBatchContext();

    handleArchived(ce, info, ctx);

    expect(ctx.transfers).toHaveLength(1);
    expect(ctx.transfers[0]).toMatchObject({
      protocolId: 'tx-a/c1/archived',
      from: 'alice::fp',
      amount: '1000',
      parent: { type: 'pool', ref: 'bank::fp/TOK' },
      labels: { type: 'holding_archived' },
      balanceChanges: [{ address: 'alice::fp', operation: 'subtract', amount: '1000' }],
    });
    expect(ctx.transfers[0].to).toBeUndefined();

    const frag = ctx.fragmentMap.get('alice::fp/c1');
    expect(frag).toMatchObject({
      labels: { chain: 'canton', spent: 'true' },
    });
  });

  it('marks spent without transfer for TI (no amount/pool)', () => {
    const ce = makeEvent({ eventType: 'archived', contractId: 'ti-1', transactionId: 'tx-b' });
    const info = { owner: 'alice::fp' };
    const ctx = makeBatchContext();

    handleArchived(ce, info, ctx);

    expect(ctx.transfers).toHaveLength(0);
    const frag = ctx.fragmentMap.get('alice::fp/ti-1');
    expect(frag).toMatchObject({
      labels: { chain: 'canton', spent: 'true' },
      updateType: 'create_or_update',
    });
  });

  it('marks existing fragment as spent in-place', () => {
    const ce = makeEvent({ eventType: 'archived', contractId: 'c2', transactionId: 'tx-c' });
    const ctx = makeBatchContext();
    ctx.fragmentMap.set('alice::fp/c2', {
      name: 'c2', address: 'alice::fp',
      labels: { chain: 'canton', type: 'holding', spent: 'false' },
    });

    handleArchived(ce, { owner: 'alice::fp' }, ctx);

    expect(ctx.fragmentMap.get('alice::fp/c2')?.labels).toMatchObject({ spent: 'true' });
  });

  it('enriches transfer with receiver from txContext', () => {
    const ce = makeEvent({ eventType: 'archived', contractId: 'c3', transactionId: 'tx-d' });
    const txContext = new Map([['tx-d', {
      sender: 'alice::fp', receiver: 'bob::fp', contractId: 'ti-x',
    }]]);
    const info = { owner: 'alice::fp', amount: '500', asset: 'TOK', poolRef: 'bank::fp/TOK' };
    const ctx = makeBatchContext({ txContext });

    handleArchived(ce, info, ctx);

    expect(ctx.transfers[0]).toMatchObject({
      from: 'alice::fp',
      to: 'bob::fp',
      labels: { type: 'transfer', direction: 'send', transferInstructionId: 'ti-x' },
    });
  });
});

describe('resolveFromEvent', () => {
  it('resolves owner from Holding interface view', () => {
    const ce = makeEvent({
      interfaceViews: [holdingInterfaceView({ owner: 'Alice::FP', amount: '100' })],
    });
    const info = resolveFromEvent(ce);
    expect(info).toEqual({ owner: 'alice::fp' });
  });

  it('resolves owner from TransferInstruction arguments', () => {
    const ce = makeEvent({
      arguments: { transfer: { sender: 'Bob::FP', receiver: 'x', amount: '1' } },
    });
    const info = resolveFromEvent(ce);
    expect(info).toEqual({ owner: 'bob::fp' });
  });

  it('falls back to signatories when TI sender is empty', () => {
    const ce = makeEvent({
      signatories: ['sig::fp'],
      arguments: { transfer: { sender: '', receiver: 'x', amount: '1' } },
    });
    const info = resolveFromEvent(ce);
    expect(info).toEqual({ owner: 'sig::fp' });
  });

  it('returns undefined when no view data', () => {
    expect(resolveFromEvent(makeEvent({}))).toBeUndefined();
  });
});
