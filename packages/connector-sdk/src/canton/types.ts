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

// ── Contract event types ─────────────────────────────────────────────────────

/**
 * A contract lifecycle event of the `contractEvents` stream (UpdateService.GetUpdates).
 * The stream can also deliver {@link CantonCompletionFailedEvent}; use
 * {@link CantonStreamEvent} and {@link isCompletionFailed} to handle both.
 */
export type CantonContractEvent = {
  eventType: 'created' | 'archived' | 'exercised';
  contractId: string;
  /** `PackageId:Module:Entity`; stream filters use `#PackageName:Module:Entity`. */
  templateId: string;
  packageId: string;
  packageName?: string;
  moduleName: string;
  entityName: string;
  /**
   * Create arguments (`created`) or choice argument (`exercised`), in the same JSON
   * shapes the generated APIs accept: Date `YYYY-MM-DD`, Time RFC 3339, RelTime
   * microseconds, Numeric as a string, GenMap with non-Text keys as `[{key, value}]`.
   */
  arguments?: Record<string, unknown> | null;
  choice?: string;
  /** Set (true or false) only for `exercised` events. */
  consuming?: boolean;
  /** Participant offset; ledger events and failures share the sequence. */
  offset: number;
  /** Command id: the workflow transaction ID for commands submitted by the connector; empty when submitted elsewhere. */
  transactionId: string;
  /** Set by direct submissions to the workflow transaction ID; visible to every participant of the transaction. */
  workflowId: string;
  /** Ledger effective time. */
  effectiveAt?: string | null;
  updateId: string;
  /** Synchronizer record time of the transaction. */
  recordTime?: string | null;
  createdEventBlob?: string;
  synchronizerId?: string;
  signatories?: string[];
  observers?: string[];
  interfaceViews?: ContractInterfaceView[];
};

/**
 * A command submitted on this participant that Canton rejected after accepting the
 * submission (CommandCompletionService.GetCompletions). It has no ledger events, so
 * this is its only event on the `contractEvents` stream.
 */
export type CantonCompletionFailedEvent = {
  eventType: typeof COMPLETION_FAILED;
  /** Command id: the workflow transaction ID for commands submitted by the connector. */
  transactionId: string;
  offset: number;
  synchronizerId?: string;
  /** Synchronizer record time of the rejection. */
  recordTime?: string | null;
  completion: CantonCompletion;
};

/** Any event of the `contractEvents` stream. */
export type CantonStreamEvent = CantonContractEvent | CantonCompletionFailedEvent;

export type ContractInterfaceView = {
  interfaceId: string;
  packageId: string;
  packageName?: string;
  moduleName: string;
  entityName: string;
  viewValue?: Record<string, unknown> | null;
};

// ── Stream configuration ─────────────────────────────────────────────────────

export type CantonContractEventsFilters = {
  /** Parties to listen for. Specify ALL parties involved in your contracts for complete archive tracking. */
  parties?: string[];
  /** Template IDs to filter on. Format: #PackageName:Module:Entity */
  templateIds?: string[];
  /** Interface IDs to filter on. Format: #PackageName:Module:Entity */
  interfaceIds?: string[];
};

export type CantonContractEventsStream = {
  /** Maximum time to wait for events before returning to update the checkpoint (e.g. '5s'). */
  pollTimeout?: string | null;
  /** Maximum events per batch dispatched to the event processor. */
  batchSize?: number | null;
  /** Internal channel buffer size for the background stream listener. */
  channelBufferSize?: number | null;
};

export type CantonContractEventsCompletions = {
  /** Emit `completion_failed` for rejected commands (default: true). Requires Canton 3.5.7+. */
  enabled?: boolean;
  /** Only failures of commands submitted by these Ledger API users (default: all). */
  userIds?: string[];
};

export type CantonContractEventsConfig = {
  fromOffset?: number | null;
  fromCurrentOffset?: boolean;
  includeCreatedEventBlob?: boolean | null;
  userId?: string;
  filters?: CantonContractEventsFilters;
  stream?: CantonContractEventsStream;
  completions?: CantonContractEventsCompletions;
};

// ── Failed commands (completion_failed) ─────────────────────────────────────

/** Event type of a command Canton rejected after accepting the submission. */
export const COMPLETION_FAILED = 'completion_failed';

/** Decoded google.rpc.Status of a command completion. */
export type CantonCompletionStatus = {
  /** gRPC status code; 0 means success. */
  code: number;
  /** Canton error id, e.g. `LOCAL_VERDICT_LOCKED_CONTRACTS`. */
  errorId?: string;
  message?: string;
  /** Canton error metadata, e.g. `reported_by_participant_id`. */
  metadata?: Record<string, string>;
};

/** A command Canton rejected, reported on the submitting participant. */
export type CantonCompletion = {
  commandId: string;
  submissionId?: string;
  userId?: string;
  actAs?: string[];
  offset: number;
  synchronizerId?: string;
  recordTime?: string | null;
  status: CantonCompletionStatus;
};

/** True for a `completion_failed` event; narrows to {@link CantonCompletionFailedEvent}. */
export function isCompletionFailed(ev: CantonStreamEvent): ev is CantonCompletionFailedEvent {
  return ev.eventType === COMPLETION_FAILED;
}

// ── CIP-56 well-known interface IDs ─────────────────────────────────────────

export const HOLDING_INTERFACE = 'Splice.Api.Token.HoldingV1:Holding';
export const TRANSFER_INSTRUCTION_INTERFACE =
  'Splice.Api.Token.TransferInstructionV1:TransferInstruction';

// ── CIP-56 interface view payload types ─────────────────────────────────────

export type HoldingView = {
  owner: string;
  amount: string;
  instrumentId?: {
    admin?: string;
    id?: string;
  };
  lock?: unknown;
  meta?: {
    values?: Record<string, string>;
  };
};

export type TransferData = {
  sender: string;
  receiver: string;
  amount: string;
  instrumentId?: {
    admin?: string;
    id?: string;
  };
};
