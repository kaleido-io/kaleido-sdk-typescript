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

/**
 * Canton CIP-56 ledger updates -> Kaleido Token Subledger rows.
 *
 *   Canton                          Subledger
 *   update                      ->  blockchain Transaction   name = update id, ledgerSequence = offset
 *   created/exercised/archived  ->  blockchain Event         name = index in the update, ledgerSequence = offset/index
 *   created contract            ->  blockchain State         name = contract id prefix, locator = contract id,
 *                                                            labels = what the indexer needs again later
 *   archive / consuming exercise->  blockchain StateArchival
 *   party (owner, admin,        ->  registry Party + Wallet + wallet identifier `canton:<party id>`
 *     sender, receiver)                                      (coins, locks and balances are counted per wallet)
 *   instrument {admin, id}      ->  registry Asset + token Token (standard CIP-56, decimals 10)
 *   Holding create              ->  token Coin (holder = owner), plus a Lock when the holding is locked
 *   Holding archive             ->  token CoinSpend (+ LockRelease)
 *   update, per instrument      ->  token Transfer: the net change per holder (no transfer when nothing moved,
 *                                                     e.g. a lock or a split)
 *
 * Every row is named from ledger ids and written create_or_ignore, so a redelivered batch or a
 * replay from offset 0 writes nothing twice. No cache: an archive of a contract created in an
 * earlier batch reads that contract's State labels (one query per batch); an archive of a contract
 * never seen gets a bare State so its archival always has a parent.
 */

import { createHash } from 'node:crypto';
import type { BulkUpsertBuilder } from '@kaleido-io/subledger-sdk';
import type { CantonContractEvent, CantonUpdateEvent, HoldingView } from '../canton/types.js';
import { extractTransferData, findHoldingView, isArchive, isCreate, shortPartyName, toBaseUnits } from '../canton/helpers.js';

/** Daml Numeric 10: every CIP-56 amount. */
export const DECIMALS = 10;
export const TOKEN_STANDARD = 'CIP-56';
/** The wallet identifier scheme: the value is the Canton party id, which is a coin's `holder`. */
export const WALLET_SCHEME = 'canton';

const URN_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

// ── names ───────────────────────────────────────────────────────────────────

/** A URN segment from free text: kept when valid, else made safe, else a sha256. */
export function segment(s: string): string {
  if (URN_SEGMENT.test(s)) return s;
  const safe = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (URN_SEGMENT.test(safe)) return safe;
  return createHash('sha256').update(s).digest('hex');
}

/**
 * A contract's State name. A Canton contract id is `00` + a 32-byte random discriminator + a
 * suffix (138 hex chars, over the 128-char URN segment limit); the first 66 chars identify it.
 * The full id is the State's `locator`, which is what lookups use.
 */
export function stateName(contractId: string): string {
  if (URN_SEGMENT.test(contractId)) return contractId;
  const prefix = contractId.slice(0, 66);
  if (/^00[0-9a-f]{64}$/.test(prefix)) return prefix;
  return createHash('sha256').update(contractId).digest('hex');
}

export const transactionName = (updateId: string) => segment(updateId);
/** Party and wallet name: `issuer-001::1220ab…` -> `issuer-001-1220ab…`. */
export const partyName = (party: string) => segment(party);
/** Asset and token name: the instrument id (the stream is filtered to one admin). */
export const instrumentName = (id: string) => segment(id);

const chainUrn = (chain: string) => `urn:kld:chain=${chain}`;
const stateUrn = (chain: string, name: string) => `${chainUrn(chain)}:state=${name}`;
const txUrn = (chain: string, tx: string) => `${chainUrn(chain)}:transaction=${tx}`;
const eventUrn = (chain: string, tx: string, index: number) => `${txUrn(chain, tx)}:event=${index}`;

// ── what a contract is ────────────────────────────────────────────────────────

export type Facts =
  | { kind: 'holding'; owner: string; admin: string; instrumentId: string; amount: string; locked: boolean; lock?: unknown }
  | { kind: 'transfer-instruction'; sender: string; receiver: string; admin: string; instrumentId: string; amount: string }
  | { kind: 'contract' };

/** The CIP-56 facts of a created contract, from its interface views. */
export function factsOfCreate(ce: CantonContractEvent): Facts {
  const hv = findHoldingView(ce)?.viewValue as unknown as HoldingView | undefined;
  if (hv?.owner && hv.instrumentId?.id) {
    return {
      kind: 'holding',
      owner: hv.owner,
      admin: hv.instrumentId.admin ?? '',
      instrumentId: hv.instrumentId.id,
      amount: String(hv.amount ?? '0'),
      locked: hv.lock != null,
      ...(hv.lock != null ? { lock: hv.lock } : {}),
    };
  }
  const td = extractTransferData(ce);
  if (td?.instrumentId?.id) {
    return {
      kind: 'transfer-instruction',
      sender: td.sender,
      receiver: td.receiver,
      admin: td.instrumentId.admin ?? '',
      instrumentId: td.instrumentId.id,
      amount: String(td.amount ?? '0'),
    };
  }
  return { kind: 'contract' };
}

/** The facts as State labels — all an archive in a later batch needs. */
export function labelsOfFacts(f: Facts): Record<string, string> {
  switch (f.kind) {
    case 'holding':
      return { kind: f.kind, owner: f.owner, admin: f.admin, instrumentId: f.instrumentId, amount: f.amount, locked: String(f.locked) };
    case 'transfer-instruction':
      return { kind: f.kind, sender: f.sender, receiver: f.receiver, admin: f.admin, instrumentId: f.instrumentId, amount: f.amount };
    default:
      return { kind: f.kind };
  }
}

/** The facts back from a State's labels (a contract created in an earlier batch). */
export function factsOfLabels(l: Record<string, string> | undefined): Facts | undefined {
  if (!l?.kind) return undefined;
  if (l.kind === 'holding' && l.owner && l.instrumentId) {
    return { kind: 'holding', owner: l.owner, admin: l.admin ?? '', instrumentId: l.instrumentId, amount: l.amount ?? '0', locked: l.locked === 'true' };
  }
  if (l.kind === 'transfer-instruction' && l.instrumentId) {
    return { kind: 'transfer-instruction', sender: l.sender ?? '', receiver: l.receiver ?? '', admin: l.admin ?? '', instrumentId: l.instrumentId, amount: l.amount ?? '0' };
  }
  return { kind: 'contract' };
}

// ── the batch ─────────────────────────────────────────────────────────────────

export interface Target {
  /** The blockchain Chain every row is written under. */
  chain: string;
  /** The `source` of each chain transaction (who wrote it). */
  source: string;
}

/** Contracts archived (or consumed) in these updates but created before them: their State is read first. */
export function contractsToLookUp(updates: CantonUpdateEvent[]): string[] {
  const created = new Set<string>();
  const wanted = new Set<string>();
  for (const u of updates) {
    for (const ce of u.events ?? []) {
      if (isCreate(ce)) created.add(ce.contractId);
      else if (isArchive(ce) && !created.has(ce.contractId)) wanted.add(ce.contractId);
    }
  }
  return [...wanted];
}

export type Counts = Record<'transactions' | 'events' | 'states' | 'archivals' | 'parties' | 'tokens' | 'coins' | 'locks' | 'spends' | 'transfers', number>;

const clean = (o: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
};

/** The event fields worth keeping as an Event's / State's info (no created-event blob). */
function eventInfo(ce: CantonContractEvent): Record<string, unknown> {
  const c = ce as CantonContractEvent & Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['eventType', 'templateId', 'packageName', 'contractId', 'choice', 'consuming', 'arguments', 'exerciseResult', 'signatories', 'observers', 'interfaceViews']) {
    if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  }
  return out;
}

/**
 * Map a batch of ledger updates (in ledger order). `prior` holds the State labels of contracts
 * created in an earlier batch (contractsToLookUp). Rows go to two builders, sent in order:
 * `first` (registry, blockchain, token) then `endings` (state archivals, coin spends, lock
 * releases) — the subledger handles an ending before its parent within one request, so an ending
 * whose parent is created in the same batch must come in a later one.
 */
export function mapBatch(
  updates: CantonUpdateEvent[],
  prior: Map<string, Record<string, string>>,
  target: Target,
  first: BulkUpsertBuilder,
  endings: BulkUpsertBuilder,
): Counts {
  const { chain, source } = target;
  const counts: Counts = { transactions: 0, events: 0, states: 0, archivals: 0, parties: 0, tokens: 0, coins: 0, locks: 0, spends: 0, transfers: 0 };
  const seen = { parties: new Set<string>(), tokens: new Set<string>() };

  const ensureParty = (party: string | undefined, type: string) => {
    if (!party || seen.parties.has(party)) return;
    seen.parties.add(party);
    const name = partyName(party);
    first.registry.add({
      parties: { items: [{ name, type, labels: { party, displayName: shortPartyName(party) } }] },
      wallets: { items: [{ name, labels: { party, partyUrn: `urn:kld:party=${name}` } }] },
      walletIdentifiers: { items: [{ value: party, scheme: WALLET_SCHEME, walletUrn: name }] },
    });
    counts.parties++;
  };

  const ensureInstrument = (admin: string, id: string): string => {
    const name = instrumentName(id);
    if (seen.tokens.has(name)) return name;
    seen.tokens.add(name);
    ensureParty(admin, 'financial-institution');
    const labels = clean({ instrumentId: id, admin });
    first.registry.add({ assets: { items: [{ name, decimals: DECIMALS, labels }] } });
    first.token.add({
      tokens: { items: [{ name, chainUrn: chainUrn(chain), standard: TOKEN_STANDARD, locator: `${id}@${admin}`, decimals: DECIMALS, assetUrn: name, symbol: id, labels }] },
    });
    counts.tokens++;
    return name;
  };

  /** A holding's coin (and lock): written at create, and again (create_or_ignore) before a spend. */
  const putCoin = (cid: string, f: Extract<Facts, { kind: 'holding' }>, minor: string, template?: string) => {
    const tok = ensureInstrument(f.admin, f.instrumentId);
    ensureParty(f.owner, 'legal-entity');
    const name = stateName(cid);
    const origin = stateUrn(chain, name);
    const labels = clean({ template, instrumentId: f.instrumentId, owner: f.owner, locked: String(f.locked) });
    first.token.add({ coins: [{ tokenUrn: tok, items: [{ name, locator: cid, holder: f.owner, amount: minor, originUrn: origin, labels }] }] });
    counts.coins++;
    if (f.locked) {
      first.token.add({
        locks: [{ tokenUrn: tok, items: [{ name, locator: cid, holder: f.owner, amount: minor, originUrn: origin, ...(f.lock ? { info: { lock: f.lock } } : {}), labels }] }],
      });
      counts.locks++;
    }
    return tok;
  };

  /** Per update and instrument, the net change per holder. */
  const deltas = new Map<string, { tx: string; updateId: string; timestamp?: string; tok: string; byHolder: Map<string, bigint>; instructions: Set<string> }>();
  const delta = (tx: string, updateId: string, timestamp: string | undefined, tok: string) => {
    const key = `${tx}|${tok}`;
    let d = deltas.get(key);
    if (!d) deltas.set(key, (d = { tx, updateId, timestamp, tok, byHolder: new Map(), instructions: new Set() }));
    return d;
  };

  const createdFacts = new Map<string, Facts>();
  const archived = new Set<string>();

  for (const u of updates) {
    const events = (u.events ?? []) as CantonContractEvent[];
    const updateId = String(u.updateId ?? events[0]?.updateId ?? '');
    const offset = Number(u.offset ?? events[0]?.offset);
    if (!updateId || !Number.isFinite(offset) || events.length === 0) continue;
    const tx = transactionName(updateId);
    const recordTime = u.recordTime ?? events[0]?.recordTime ?? undefined;
    const timestamp = recordTime ?? u.effectiveAt ?? events[0]?.effectiveAt ?? undefined;

    first.blockchain.add({
      transactions: [{
        chainUrn: chain,
        items: [{
          name: tx,
          ledgerSequence: String(offset),
          source,
          info: clean({ updateId, recordTime, effectiveAt: u.effectiveAt, transactionId: u.transactionId, synchronizerId: u.synchronizerId }),
          labels: clean({ recordTime }),
        }],
      }],
    });
    counts.transactions++;

    events.forEach((ce, index) => {
      const evUrn = eventUrn(chain, tx, index);
      first.blockchain.add({
        events: [{
          chainUrn: chain,
          items: [{
            transactionUrn: tx,
            name: String(index),
            ledgerSequence: `${offset}/${index}`,
            info: eventInfo(ce),
            labels: clean({ eventType: ce.eventType, template: ce.entityName, choice: ce.choice, contractId: ce.contractId }),
          }],
        }],
      });
      counts.events++;
      const name = stateName(ce.contractId);

      if (isCreate(ce)) {
        const f = factsOfCreate(ce);
        createdFacts.set(ce.contractId, f);
        first.blockchain.add({
          states: [{
            chainUrn: chain,
            items: [{
              name,
              locator: ce.contractId,
              originUrn: evUrn,
              info: eventInfo(ce),
              labels: clean({ template: ce.entityName, module: ce.moduleName, ...labelsOfFacts(f) }),
            }],
          }],
        });
        counts.states++;
        if (f.kind === 'holding') {
          const minor = toBaseUnits(f.amount);
          if (/^[1-9]\d*$/.test(minor)) {
            const tok = putCoin(ce.contractId, f, minor, ce.entityName);
            const d = delta(tx, updateId, timestamp, tok);
            d.byHolder.set(f.owner, (d.byHolder.get(f.owner) ?? 0n) + BigInt(minor));
          }
        } else if (f.kind === 'transfer-instruction') {
          ensureInstrument(f.admin, f.instrumentId);
          ensureParty(f.sender, 'legal-entity');
          ensureParty(f.receiver, 'legal-entity');
        }
      }

      const f = createdFacts.get(ce.contractId) ?? factsOfLabels(prior.get(ce.contractId));
      if (ce.eventType === 'exercised' && f?.kind === 'transfer-instruction') {
        delta(tx, updateId, timestamp, instrumentName(f.instrumentId)).instructions.add(ce.contractId);
      }

      // A consuming exercise and its archive are one archive.
      if (isArchive(ce) && !archived.has(ce.contractId)) {
        archived.add(ce.contractId);
        if (!f) {
          // Never seen (created before the stream started): a bare State, so the archival has a parent.
          first.blockchain.add({ states: [{ chainUrn: chain, items: [{ name, locator: ce.contractId }] }] });
          counts.states++;
        }
        endings.blockchain.add({ stateArchivals: [{ chainUrn: chain, items: [{ stateUrn: name, originUrn: evUrn }] }] });
        counts.archivals++;
        if (f?.kind === 'holding') {
          const minor = toBaseUnits(f.amount);
          if (/^[1-9]\d*$/.test(minor)) {
            const tok = createdFacts.has(ce.contractId) ? instrumentName(f.instrumentId) : putCoin(ce.contractId, f, minor);
            endings.token.add({ coinSpends: [{ tokenUrn: tok, items: [{ coinUrn: name, originUrn: evUrn }] }] });
            if (f.locked) endings.token.add({ lockReleases: [{ tokenUrn: tok, items: [{ lockUrn: name, originUrn: evUrn }] }] });
            counts.spends++;
            const d = delta(tx, updateId, timestamp, tok);
            d.byHolder.set(f.owner, (d.byHolder.get(f.owner) ?? 0n) - BigInt(minor));
          }
        }
      }
    });
  }

  for (const d of deltas.values()) {
    const balanceChanges = [...d.byHolder.entries()].filter(([, v]) => v !== 0n).map(([holder, v]) => ({ holder, amount: v.toString() }));
    if (balanceChanges.length === 0 || !d.timestamp) continue; // a lock, a split, a merge: nothing moved
    first.token.add({
      transfers: [{
        tokenUrn: d.tok,
        items: [{
          name: d.tx,
          timestamp: d.timestamp,
          originUrn: txUrn(chain, d.tx),
          balanceChanges,
          labels: clean({ updateId: d.updateId, transferInstruction: [...d.instructions][0] }),
        }],
      }],
    });
    counts.transfers++;
  }
  return counts;
}
