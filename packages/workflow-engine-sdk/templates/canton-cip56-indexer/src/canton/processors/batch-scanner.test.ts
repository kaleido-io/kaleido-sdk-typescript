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
import { scanCreates, scanContextAndMisses } from './batch-scanner.js';
import type { TransferContext } from '../types.js';
import { makeEvent, holdingInterfaceView } from '../test-helpers.js';

function wrapEvents(events: ReturnType<typeof makeEvent>[]) {
  return events.map((e) => ({ data: e }));
}

describe('scanCreates', () => {
  it('populates contracts map from Holding creates', () => {
    const event = makeEvent({
      contractId: 'h1',
      interfaceViews: [holdingInterfaceView({
        owner: 'Alice::FP',
        amount: '100',
        instrumentId: { admin: 'Bank::FP', id: 'TOK' },
      })],
    });

    const { contracts, batchTI } = scanCreates(wrapEvents([event]));

    expect(contracts.get('h1')).toMatchObject({
      owner: 'alice::fp',
      amount: '1000000000000',
      asset: 'TOK',
      poolRef: 'bank::fp/TOK',
    });
    expect(batchTI.size).toBe(0);
  });

  it('populates contracts and batchTI from TI creates', () => {
    const event = makeEvent({
      contractId: 'ti-1',
      arguments: {
        transfer: { sender: 'alice::fp', receiver: 'bob::fp', amount: '50', instrumentId: { id: 'TOK' } },
      },
    });

    const { contracts, batchTI } = scanCreates(wrapEvents([event]));

    expect(contracts.get('ti-1')).toMatchObject({ owner: 'alice::fp' });
    expect(batchTI.get('ti-1')).toMatchObject({
      sender: 'alice::fp',
      receiver: 'bob::fp',
      amount: '50',
    });
  });

  it('skips non-created events', () => {
    const event = makeEvent({ eventType: 'archived' });
    const { contracts } = scanCreates(wrapEvents([event]));
    expect(contracts.size).toBe(0);
  });
});

describe('scanContextAndMisses', () => {
  it('collects archive misses for unknown contracts', () => {
    const event = makeEvent({ eventType: 'archived', contractId: 'unknown-c' });
    const contracts = new Map();
    const batchTI = new Map();

    const result = scanContextAndMisses(
      wrapEvents([event]), contracts, batchTI, new Map(),
    );

    expect(result.archiveMisses.has('unknown-c')).toBe(true);
  });

  it('does not add archive miss when contract is known', () => {
    const event = makeEvent({ eventType: 'archived', contractId: 'known-c' });
    const contracts = new Map([['known-c', { owner: 'alice::fp' }]]);

    const result = scanContextAndMisses(
      wrapEvents([event]), contracts, new Map(), new Map(),
    );

    expect(result.archiveMisses.size).toBe(0);
  });

  it('promotes batchTI to txContext on consuming exercise', () => {
    const event = makeEvent({
      eventType: 'exercised',
      consuming: true,
      contractId: 'ti-1',
      transactionId: 'tx-accept',
    });
    const batchTI = new Map<string, TransferContext>([
      ['ti-1', { sender: 'alice::fp', receiver: 'bob::fp' }],
    ]);
    const txTransferContext = new Map<string, TransferContext>();

    const result = scanContextAndMisses(
      wrapEvents([event]), new Map(), batchTI, txTransferContext,
    );

    expect(result.txContext.get('tx-accept')).toMatchObject({
      sender: 'alice::fp',
      receiver: 'bob::fp',
      contractId: 'ti-1',
    });
    expect(txTransferContext.get('tx-accept')).toBeDefined();
    expect(batchTI.has('ti-1')).toBe(false);
  });

  it('collects TI misses when exercise has unknown contractId', () => {
    const event = makeEvent({
      eventType: 'exercised',
      consuming: true,
      contractId: 'ti-unknown',
      transactionId: 'tx-x',
    });

    const result = scanContextAndMisses(
      wrapEvents([event]), new Map(), new Map(), new Map(),
    );

    expect(result.tiMisses).toContain('ti-unknown');
    expect(result.exerciseEvents).toHaveLength(1);
  });

  it('restores prior txTransferContext', () => {
    const event = makeEvent({ transactionId: 'tx-prior' });
    const prior = new Map<string, TransferContext>([
      ['tx-prior', { sender: 'alice::fp', receiver: 'bob::fp' }],
    ]);

    const result = scanContextAndMisses(
      wrapEvents([event]), new Map(), new Map(), prior,
    );

    expect(result.txContext.get('tx-prior')).toMatchObject({
      sender: 'alice::fp',
    });
  });

  it('collects all transaction IDs in batch', () => {
    const events = [
      makeEvent({ transactionId: 'tx-a' }),
      makeEvent({ transactionId: 'tx-b' }),
      makeEvent({ transactionId: 'tx-a' }),
    ];

    const result = scanContextAndMisses(
      wrapEvents(events), new Map(), new Map(), new Map(),
    );

    expect(result.txIdsInBatch).toEqual(new Set(['tx-a', 'tx-b']));
  });
});
