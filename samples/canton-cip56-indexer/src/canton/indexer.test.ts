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

import { describe, it, expect, beforeEach } from 'vitest';
import type { CantonConfig } from '../config.js';
import { CantonCIP56Indexer } from './indexer.js';
import type { SetupContext } from '@kaleido-io/core-sdk/context';
import {
  ADMIN, ALICE, BOB,
  FakeSubledger,
  archive,
  holding,
  makeCompletionFailed,
  makeEvent,
  mockEventProcessorContext,
  tiInterfaceView,
  wrapEvents,
} from './test-helpers.js';
import { stateName } from '../subledger/mapping.js';

const units = (n: number) => (BigInt(n) * 10n ** 10n).toString();
const cid = (n: number) => '00' + n.toString(16).padStart(64, '0') + 'ca'.repeat(36); // a 138-char Canton contract id

// The demo flows of sub-canton (05_mint, 06_transfer, 07_accept, 08_preapproval).
const H1 = cid(1), H2 = cid(2), H3 = cid(3), H4 = cid(4), H5 = cid(5), H6 = cid(6), TI = cid(7);
const lock = { holders: [ADMIN], expiresAt: null, expiresAfter: null, context: 'transfer to party-002' };

const mint = () => [holding(H1, ALICE, '100.0000000000', { offset: 10, transactionId: 't-mint', updateId: '1220aa01' })];
const offer = () => {
  const u = { offset: 20, transactionId: 't-offer', updateId: '1220aa02' };
  return [
    archive(H1, { ...u }),
    holding(H2, ALICE, '30.0000000000', { ...u, lock }),
    holding(H3, ALICE, '70.0000000000', { ...u }),
    makeEvent({
      ...u,
      contractId: TI,
      templateId: 'pkg:SimpleToken:SimpleTransferInstruction',
      entityName: 'SimpleTransferInstruction',
      interfaceViews: [tiInterfaceView({ sender: ALICE, receiver: BOB, amount: '30.0000000000', instrumentId: { admin: ADMIN, id: 'TOK1' } })],
    }),
  ];
};
const accept = () => {
  const u = { offset: 30, transactionId: 't-accept', updateId: '1220aa03' };
  return [
    archive(TI, { ...u, choice: 'TransferInstruction_Accept', entityName: 'SimpleTransferInstruction' }),
    archive(H2, { ...u }),
    holding(H4, BOB, '30.0000000000', { ...u }),
  ];
};
const direct = () => {
  const u = { offset: 40, transactionId: 't-direct', updateId: '1220aa04' };
  return [archive(H3, { ...u }), holding(H5, BOB, '20.0000000000', { ...u }), holding(H6, ALICE, '50.0000000000', { ...u })];
};

describe('CantonCIP56Indexer -> subledger', () => {
  let sl: FakeSubledger;
  let indexer: CantonCIP56Indexer;
  const ctx = mockEventProcessorContext();

  beforeEach(() => {
    sl = new FakeSubledger();
    indexer = new CantonCIP56Indexer(() => sl);
  });

  it('setup creates the chain and checks its sequence levels', async () => {
    await indexer.setup(ctx as unknown as SetupContext<CantonConfig>);
    expect(sl.items('blockchain', 'chains')).toMatchObject([{ name: 'canton', transactionSequenceLevels: 1, eventSequenceLevels: 2 }]);
    sl.chainLevels = { transactionSequenceLevels: 2, eventSequenceLevels: 2 };
    let err: Error | undefined;
    await indexer.setup(ctx as unknown as SetupContext<CantonConfig>).catch((e) => (err = e));
    expect(err?.message).toMatch(/immutable on a chain/);
  });

  it('mint: evidence, parties with wallets, token, coin and a transfer', async () => {
    await indexer.processBatch(ctx, wrapEvents(mint()));
    expect(sl.bodies).toHaveLength(1); // no endings
    expect(sl.items('blockchain', 'transactions')).toMatchObject([{ name: '1220aa01', ledgerSequence: '10', source: 'canton-cip56-indexer' }]);
    expect(sl.items('blockchain', 'events')).toMatchObject([{ transactionUrn: '1220aa01', name: '0', ledgerSequence: '10/0' }]);
    expect(sl.items('blockchain', 'states')).toMatchObject([{
      name: stateName(H1), locator: H1,
      labels: { template: 'SimpleHolding', kind: 'holding', owner: ALICE, admin: ADMIN, instrumentId: 'TOK1', amount: '100.0000000000', locked: 'false' },
    }]);
    expect(stateName(H1)).toHaveLength(66);
    expect(sl.items('registry', 'parties')).toMatchObject([
      { name: 'issuer-001-1220aa', type: 'financial-institution' },
      { name: 'party-001-1220bb', type: 'legal-entity' },
    ]);
    // the wallet identifier is the party id: coins and balances of that holder count in the wallet
    expect(sl.items('registry', 'walletIdentifiers')).toMatchObject([
      { value: ADMIN, scheme: 'canton', walletUrn: 'issuer-001-1220aa' },
      { value: ALICE, scheme: 'canton', walletUrn: 'party-001-1220bb' },
    ]);
    expect(sl.items('token', 'tokens')).toMatchObject([{ name: 'TOK1', chainUrn: 'urn:kld:chain=canton', standard: 'CIP-56', decimals: 10, assetUrn: 'TOK1' }]);
    expect(sl.items('token', 'coins')).toMatchObject([{ tokenUrn: 'TOK1', name: stateName(H1), locator: H1, holder: ALICE, amount: units(100) }]);
    expect(sl.items('token', 'transfers')).toMatchObject([{
      tokenUrn: 'TOK1', name: '1220aa01', timestamp: '2026-11-03T10:00:00Z', balanceChanges: [{ holder: ALICE, amount: units(100) }],
    }]);
  });

  it('two-step transfer: the offer locks (no transfer), the accept moves the balance', async () => {
    await indexer.processBatch(ctx, wrapEvents(mint()));
    const n = sl.bodies.length;
    await indexer.processBatch(ctx, wrapEvents(offer()));
    // H1 was created in the earlier batch: found by its State, re-stated as a coin, then spent
    const offerBodies = sl.bodies.slice(n);
    expect(offerBodies).toHaveLength(2);
    expect(offerBodies[1].token?.coinSpends?.[0]?.items).toMatchObject([{ coinUrn: stateName(H1) }]);
    expect(offerBodies[1].blockchain?.stateArchivals?.[0]?.items).toMatchObject([{ stateUrn: stateName(H1) }]);
    expect(offerBodies[0].token?.locks?.[0]?.items).toMatchObject([{ name: stateName(H2), holder: ALICE, amount: units(30), info: { lock } }]);
    expect(offerBodies[0].token?.transfers).toBeUndefined(); // Alice: -100 +30 +70 = 0
    expect(sl.items('registry', 'parties').map((p) => p.name)).toContain('party-002-1220cc'); // the receiver

    const m = sl.bodies.length;
    await indexer.processBatch(ctx, wrapEvents(accept()));
    const [main, endings] = sl.bodies.slice(m);
    expect(main.token?.transfers?.[0]?.items).toMatchObject([{
      name: '1220aa03',
      balanceChanges: [{ holder: ALICE, amount: `-${units(30)}` }, { holder: BOB, amount: units(30) }],
      labels: { transferInstruction: TI },
    }]);
    expect(endings.token?.lockReleases?.[0]?.items).toMatchObject([{ lockUrn: stateName(H2) }]);
    expect(endings.blockchain?.stateArchivals?.[0]?.items.map((a) => a.stateUrn)).toEqual([stateName(TI), stateName(H2)]);
  });

  it('direct transfer in one batch with the rest: archives of contracts created in the same batch', async () => {
    await indexer.processBatch(ctx, wrapEvents([...mint(), ...offer(), ...accept(), ...direct()]));
    expect(sl.bodies).toHaveLength(2);
    const transfers = sl.items('token', 'transfers');
    expect(transfers.map((t) => t.name)).toEqual(['1220aa01', '1220aa03', '1220aa04']);
    expect(transfers[2].balanceChanges).toEqual([{ holder: ALICE, amount: `-${units(20)}` }, { holder: BOB, amount: units(20) }]);
    expect(sl.items('token', 'coinSpends').map((s) => s.coinUrn)).toEqual([H1, H2, H3].map(stateName));
    // Alice holds H6 (50); Bob H4 (30) + H5 (20); the coins in the subledger agree
    const spent = new Set(sl.items('token', 'coinSpends').map((s) => s.coinUrn));
    const live = sl.items('token', 'coins').filter((c) => !spent.has(c.name));
    const sum = (h: string) => live.filter((c) => c.holder === h).reduce((a, c) => a + BigInt(c.amount), 0n);
    expect(sum(ALICE).toString()).toBe(units(50));
    expect(sum(BOB).toString()).toBe(units(50));
  });

  it('an archive of a contract never seen gets a bare state and its archival, no coin spend', async () => {
    const x = cid(99);
    await indexer.processBatch(ctx, wrapEvents([archive(x, { offset: 5, transactionId: 't-x', updateId: '1220ff' })]));
    expect(sl.items('blockchain', 'states')).toEqual([{ name: stateName(x), locator: x }]);
    expect(sl.items('blockchain', 'stateArchivals')).toMatchObject([{ stateUrn: stateName(x) }]);
    expect(sl.items('token', 'coinSpends')).toHaveLength(0);
  });

  it('a replay writes the same rows (all named from ledger ids, create_or_ignore)', async () => {
    const run = async () => {
      const s = new FakeSubledger();
      const ix = new CantonCIP56Indexer(() => s);
      for (const b of [mint(), offer(), accept(), direct()]) await ix.processBatch(ctx, wrapEvents(b));
      return s.bodies;
    };
    expect(await run()).toEqual(await run());
    expect(sl.bodies.length).toBe(0);
  });

  it('a batch of failed commands writes nothing', async () => {
    await indexer.processBatch(ctx, wrapEvents([makeCompletionFailed()]));
    expect(sl.bodies).toHaveLength(0);
  });

  it('waits out a 429 and retries', async () => {
    sl.fail429 = 2;
    await indexer.processBatch(ctx, wrapEvents(mint()));
    expect(sl.bodies).toHaveLength(1);
  });

  it('uses the configured chain and source', async () => {
    const c = mockEventProcessorContext({ subledger: { chain: 'demo', source: 'me' } });
    await indexer.processBatch(c, wrapEvents(mint()));
    expect(sl.bodies[0].blockchain?.transactions?.[0]).toMatchObject({ chainUrn: 'demo', items: [{ source: 'me' }] });
    expect(sl.items('token', 'tokens')[0].chainUrn).toBe('urn:kld:chain=demo');
  });
});
