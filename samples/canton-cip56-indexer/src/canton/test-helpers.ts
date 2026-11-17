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

import { BulkUpsertBuilder } from '@kaleido-io/subledger-sdk';
import type { BulkQueryInput, BulkQueryOutput, BulkUpsertInput, BulkUpsertOutput } from '@kaleido-io/subledger-sdk';
import type {
  CantonContractEvent,
  CantonCompletionFailedEvent,
  CantonStreamEvent,
  CantonUpdateEvent,
} from './types.js';
import type { EventProcessorEvent, EventProcessorContext } from '@kaleido-io/workflow-engine-sdk';
import type { CantonConfig } from '../config.js';
import type { Subledger } from '../subledger/client.js';

export const ADMIN = 'issuer-001::1220aa';
export const ALICE = 'party-001::1220bb';
export const BOB = 'party-002::1220cc';

export function mockEventProcessorContext(config: CantonConfig = {}): EventProcessorContext<CantonConfig> {
  return {
    config,
    providerName: 'test-provider',
    handlerName: 'canton-cip56-indexer',
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    getServiceClientOptions: () => { throw new Error('not used: tests inject a fake subledger'); },
  } as unknown as EventProcessorContext<CantonConfig>;
}

type Row = Record<string, any>;

/**
 * An in-memory subledger: records every bulk body, keeps the States it was sent
 * (create_or_ignore) and answers the indexer's two queries (chain, states by locator).
 */
export class FakeSubledger implements Subledger {
  readonly bodies: BulkUpsertInput[] = [];
  readonly states = new Map<string, Row>(); // locator -> state
  chainLevels = { transactionSequenceLevels: 1, eventSequenceLevels: 2 };
  fail429 = 0;

  async bulkUpsert(input: BulkUpsertInput): Promise<BulkUpsertOutput> {
    if (this.fail429 > 0) {
      this.fail429--;
      throw Object.assign(new Error('rate limited'), { response: { status: 429, headers: { 'retry-after': '0.001' } } });
    }
    this.bodies.push(JSON.parse(JSON.stringify(input)));
    for (const sec of (input.blockchain?.states ?? []) as Row[]) {
      for (const st of sec.items) if (!this.states.has(st.locator)) this.states.set(st.locator, st);
    }
    return {};
  }

  async bulkQuery(input: BulkQueryInput): Promise<BulkQueryOutput> {
    if (input.blockchain?.chains) return { blockchain: { chains: { items: [this.chainLevels as never] } } };
    const q = input.blockchain?.states?.[0];
    const wanted = new Set(q?.in?.[0]?.values ?? []);
    const items = [...this.states.values()].filter((s) => wanted.has(s.locator));
    return { blockchain: { states: [{ items: items as never }] } };
  }

  getNewBulkUpsertBuilder(options: ConstructorParameters<typeof BulkUpsertBuilder>[1]): BulkUpsertBuilder {
    return new BulkUpsertBuilder(this, options);
  }

  /** Every item written to `module.section`, across all bodies (scoped sections flattened). */
  items(module: keyof BulkUpsertInput, section: string): Row[] {
    const out: Row[] = [];
    for (const b of this.bodies) {
      const v = (b[module] as Row | undefined)?.[section];
      for (const e of Array.isArray(v) ? v : v ? [v] : []) out.push(...e.items.map((i: Row) => ({ ...i, ...(e.tokenUrn ? { tokenUrn: e.tokenUrn } : {}) })));
    }
    return out;
  }
}

export function holdingInterfaceView(viewValue: Record<string, unknown>) {
  return {
    interfaceId: '718a0f77e505:Splice.Api.Token.HoldingV1:Holding',
    packageId: '718a0f77e505',
    packageName: 'splice-api-token-holding-v1',
    moduleName: 'Splice.Api.Token.HoldingV1',
    entityName: 'Holding',
    viewValue,
  };
}

export function makeEvent(
  overrides: Partial<CantonContractEvent>,
): CantonContractEvent {
  return {
    eventType: 'created',
    contractId: 'contract-1',
    templateId: 'pkg-abc:Test.Token:TestHolding',
    packageId: 'pkg-abc',
    moduleName: 'Test.Token',
    entityName: 'TestHolding',
    offset: 100,
    transactionId: 'tx-1',
    workflowId: 'wf-1',
    updateId: 'upd-1',
    effectiveAt: '2026-11-03T10:00:00Z',
    ...overrides,
  };
}

export function makeCompletionFailed(
  overrides?: Partial<CantonCompletionFailedEvent>,
): CantonCompletionFailedEvent {
  return {
    eventType: 'completion_failed',
    transactionId: 'tx-failed',
    offset: 101,
    synchronizerId: 'global-domain::1220',
    recordTime: '2026-09-29T10:00:00.123456Z',
    completion: {
      commandId: 'tx-failed',
      submissionId: 'sub-1',
      userId: 'participant_admin',
      actAs: ['alice::fp'],
      offset: 101,
      synchronizerId: 'global-domain::1220',
      recordTime: '2026-09-29T10:00:00.123456Z',
      status: {
        code: 10,
        errorId: 'LOCAL_VERDICT_LOCKED_CONTRACTS',
        message: 'LOCAL_VERDICT_LOCKED_CONTRACTS(2,0): Rejected transaction is referring to locked contracts',
        metadata: { reported_by_participant_id: 'PAR::participant1::1220' },
      },
    },
    ...overrides,
  };
}

/**
 * Wraps events as the stream delivers them: consecutive contract events of the same
 * transaction become one ledger update, failures stay single events.
 */
export function wrapEvents(
  events: (CantonContractEvent | CantonCompletionFailedEvent)[],
): EventProcessorEvent<CantonStreamEvent>[] {
  const out: EventProcessorEvent<CantonStreamEvent>[] = [];
  let update: CantonUpdateEvent | undefined;
  for (const e of events) {
    if (e.eventType === 'completion_failed') {
      update = undefined;
      out.push({ idempotencyKey: `completion-${out.length}`, topic: `canton.txcomplete.${e.transactionId}`, data: e });
      continue;
    }
    if (!update || update.transactionId !== e.transactionId) {
      update = {
        eventType: 'update',
        offset: e.offset,
        updateId: e.updateId,
        transactionId: e.transactionId,
        workflowId: e.workflowId,
        effectiveAt: e.effectiveAt,
        events: [],
      };
      out.push({ idempotencyKey: `update-${out.length}`, topic: `canton.txcomplete.${e.transactionId}`, data: update });
    }
    update.events.push(e);
  }
  return out;
}

export function tiInterfaceView(transfer: Record<string, unknown>) {
  return {
    interfaceId: '55ba4deb0ad4:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
    packageId: '55ba4deb0ad4',
    packageName: 'splice-api-token-transfer-instruction-v1',
    moduleName: 'Splice.Api.Token.TransferInstructionV1',
    entityName: 'TransferInstruction',
    viewValue: { transfer, status: { tag: 'TransferPendingReceiverAcceptance' }, meta: { values: {} } },
  };
}

/** A created SimpleHolding. */
export function holding(cid: string, owner: string, amount: string, ex: Partial<CantonContractEvent> & { id?: string; lock?: unknown } = {}): CantonContractEvent {
  const { id = 'TOK1', lock = null, ...rest } = ex;
  return makeEvent({
    contractId: cid,
    templateId: 'pkg:SimpleToken:SimpleHolding',
    moduleName: 'SimpleToken',
    entityName: 'SimpleHolding',
    interfaceViews: [holdingInterfaceView({ owner, amount, instrumentId: { admin: ADMIN, id }, lock, meta: { values: {} } })],
    ...rest,
  });
}

/** The archive of a contract (as a consuming exercise when `choice` is given). */
export function archive(cid: string, ex: Partial<CantonContractEvent> = {}): CantonContractEvent {
  return makeEvent({ contractId: cid, eventType: ex.choice ? 'exercised' : 'archived', consuming: ex.choice ? true : undefined, ...ex });
}
