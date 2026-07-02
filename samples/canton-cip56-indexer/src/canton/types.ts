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

import type {
  AddressBulkInput as Address,
  AssetBulkInput as Asset,
  FragmentBulkInput as Fragment,
  PoolBulkInput as Pool,
  TransferBulkInput as Transfer,
} from '@kaleido-io/asset-manager-sdk';

import type {
  CantonContractEvent,
  ContractInterfaceView,
  CantonContractEventsConfig,
  HoldingView,
  TransferData,
} from '@kaleido-io/connector-sdk/canton';

export type {
  CantonContractEvent,
  ContractInterfaceView,
  CantonContractEventsConfig,
  HoldingView,
  TransferData,
};

export {
  HOLDING_INTERFACE,
  TRANSFER_INSTRUCTION_INTERFACE,
} from '@kaleido-io/connector-sdk/canton';

// ── Indexer batch context types ─────────────────────────────────────

export type ContractInfo = {
  owner: string;
  amount?: string;
  asset?: string;
  poolRef?: string;
};

export type TransferContext = {
  sender: string;
  receiver: string;
  amount?: string;
  instrumentId?: string;
  contractId?: string;
};

export type BatchContext = {
  fragmentMap: Map<string, Fragment>;
  transfers: Transfer[];
  addressMap: Map<string, Address>;
  assetMap: Map<string, Asset>;
  poolMap: Map<string, Pool>;
  addressSet: Set<string>;
  txContext: Map<string, TransferContext>;
  contracts: Map<string, ContractInfo>;
  addAddress: (addr: Address) => void;
};

export type ScanCreatesResult = {
  contracts: Map<string, ContractInfo>;
  batchTI: Map<string, TransferContext>;
};

export type ScanContextResult = {
  txContext: Map<string, TransferContext>;
  archiveMisses: Set<string>;
  tiMisses: string[];
  exerciseEvents: CantonContractEvent[];
  txIdsInBatch: Set<string>;
};
