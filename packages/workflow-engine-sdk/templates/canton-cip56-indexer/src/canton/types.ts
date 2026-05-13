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
 * TypeScript types matching the Go structs emitted by the Canton connector.
 *
 * Go source: cantonconnect/pkg/cantontypes/event_types.go
 *            cantonconnect/pkg/cantontypes/contract_types.go
 */

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

/**
 * Stream configuration accepted by the cantonContractEvents event source.
 */
export type CantonContractEventsConfig = {
  fromOffset?: number | null;
  fromCurrentOffset?: boolean;
  pollTimeout?: string | null;
  batchSize?: number | null;
  parties?: string[];
  templateIds?: string[];
  interfaceIds?: string[];
  includeCreatedEventBlob?: boolean | null;
  userId?: string;
};
