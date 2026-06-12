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
import { handleHoldingCreated } from './holding-processor.js';
import type { HoldingView } from '../types.js';
import { makeEvent, makeBatchContext } from '../test-helpers.js';


describe('handleHoldingCreated', () => {
  it('creates fragment, addresses, asset, pool, and balance-add transfer', () => {
    const ce = makeEvent({ contractId: 'c1', transactionId: 'tx-1' });
    const view: HoldingView = {
      owner: 'alice::fp',
      amount: '1000',
      instrumentId: { admin: 'bank::fp', id: 'TestInstId' },
    };
    const ctx = makeBatchContext();

    handleHoldingCreated(ce, view, ctx);

    expect(ctx.fragmentMap.size).toBe(1);
    const frag = ctx.fragmentMap.get('alice::fp/c1');
    expect(frag).toMatchObject({
      name: 'c1',
      address: 'alice::fp',
      value: '10000000000000',
      asset: 'TestInstId',
      labels: expect.objectContaining({
        chain: 'canton',
        standard: 'CIP-56',
        type: 'holding',
        instrumentId: 'TestInstId',
        owner: 'alice::fp',
        issuer: 'bank::fp',
        spent: 'false',
      }),
    });

    expect(ctx.transfers).toHaveLength(1);
    expect(ctx.transfers[0]).toMatchObject({
      protocolId: 'tx-1/c1/created',
      to: 'alice::fp',
      amount: '10000000000000',
      labels: { type: 'holding_created' },
      balanceChanges: [{ address: 'alice::fp', operation: 'add', amount: '10000000000000' }],
    });
    expect(ctx.transfers[0].from).toBeUndefined();

    expect(ctx.addressSet.has('alice::fp')).toBe(true);
    expect(ctx.addressSet.has('bank::fp')).toBe(true);
    expect(ctx.assetMap.has('TestInstId')).toBe(true);
    expect(ctx.poolMap.has('bank::fp/TestInstId')).toBe(true);
  });

  it('adds locked label when holding has a lock', () => {
    const ce = makeEvent({ contractId: 'c-lock' });
    const view: HoldingView = {
      owner: 'alice::fp',
      amount: '100',
      instrumentId: { admin: 'bank::fp', id: 'TOK' },
      lock: { holders: ['bank::fp'] },
    };
    const ctx = makeBatchContext();

    handleHoldingCreated(ce, view, ctx);

    const frag = ctx.fragmentMap.get('alice::fp/c-lock');
    expect(frag?.labels).toMatchObject({ locked: 'true' });
  });

  it('defaults instrumentId to KLD when missing', () => {
    const ce = makeEvent({ contractId: 'c-kld' });
    const view: HoldingView = { owner: 'alice::fp', amount: '500' };
    const ctx = makeBatchContext();

    handleHoldingCreated(ce, view, ctx);

    const frag = ctx.fragmentMap.get('alice::fp/c-kld');
    expect(frag?.asset).toBe('KLD');
    expect(ctx.assetMap.has('KLD')).toBe(true);
  });

  it('converts decimal amounts to base units (x 10^10)', () => {
    const ce = makeEvent({ contractId: 'c-dec' });
    const view: HoldingView = {
      owner: 'alice::fp',
      amount: '33.1081975897',
      instrumentId: { admin: 'bank::fp', id: 'TOK' },
    };
    const ctx = makeBatchContext();

    handleHoldingCreated(ce, view, ctx);

    const frag = ctx.fragmentMap.get('alice::fp/c-dec');
    expect(frag?.value).toBe('331081975897');
    expect(ctx.transfers[0].amount).toBe('331081975897');
  });

  it('lowercases party addresses', () => {
    const ce = makeEvent({ contractId: 'c-case' });
    const view: HoldingView = {
      owner: 'ExternalBob::1220ABCD',
      amount: '100',
      instrumentId: { admin: 'Admin::1220FFFF', id: 'TOK' },
    };
    const ctx = makeBatchContext();

    handleHoldingCreated(ce, view, ctx);

    const frag = ctx.fragmentMap.get('externalbob::1220abcd/c-case');
    expect(frag?.address).toBe('externalbob::1220abcd');
    expect(ctx.poolMap.get('admin::1220ffff/TOK')?.address).toBe('admin::1220ffff');
  });

  it('enriches transfer with sender when txContext has TI data', () => {
    const ce = makeEvent({ contractId: 'c-enrich', transactionId: 'tx-accept' });
    const view: HoldingView = {
      owner: 'bob::fp',
      amount: '100',
      instrumentId: { admin: 'bank::fp', id: 'TOK' },
    };
    const txContext = new Map([['tx-accept', {
      sender: 'alice::fp', receiver: 'bob::fp', contractId: 'ti-1',
    }]]);
    const ctx = makeBatchContext({ txContext });

    handleHoldingCreated(ce, view, ctx);

    expect(ctx.transfers[0]).toMatchObject({
      from: 'alice::fp',
      to: 'bob::fp',
      labels: { type: 'transfer', direction: 'receive', transferInstructionId: 'ti-1' },
    });
  });
});
