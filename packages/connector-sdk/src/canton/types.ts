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

export type CantonContractEvent = {
  eventType: 'created' | 'archived' | 'exercised';
  contractId: string;
  templateId: string;
  packageId: string;
  packageName?: string;
  moduleName: string;
  entityName: string;
  arguments?: Record<string, unknown> | null;
  choice?: string;
  consuming?: boolean;
  offset: number;
  transactionId: string;
  workflowId: string;
  effectiveAt?: string | null;
  updateId: string;
  completionOffset: string;
  createdEventBlob?: string;
  synchronizerId?: string;
  signatories?: string[];
  observers?: string[];
  interfaceViews?: ContractInterfaceView[];
};

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

export type CantonContractEventsConfig = {
  fromOffset?: number | null;
  fromCurrentOffset?: boolean;
  includeCreatedEventBlob?: boolean | null;
  userId?: string;
  filters?: CantonContractEventsFilters;
  stream?: CantonContractEventsStream;
};

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
