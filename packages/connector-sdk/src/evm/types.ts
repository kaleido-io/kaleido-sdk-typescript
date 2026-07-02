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

export type EVMTransactionEvent = {
  transactionHash: string;
  chainId: string;
  block: EVMBlockInfo;
  transaction?: EVMTransaction;
  receipt: EVMTransactionReceipt;
  decodedEvents?: EVMDecodedLogEvent[];
  decodedError?: EVMDecodedError;
  decodedInput?: EVMDecodedFunctionInput;
  ethTransfers?: EVMNativeETHTransfer[];
};

export type EVMBlockInfo = {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  logsBloom: string;
  transactions: string[];
};

export type EVMTransaction = {
  blockHash: string;
  blockNumber: string;
  chainId: string;
  from: string;
  gas: string;
  gasPrice: string;
  hash: string;
  input: string;
  nonce: string;
  to: string;
  transactionIndex: string;
  type: string;
  value: string;
};

export type EVMTransactionReceipt = {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string;
  cumulativeGasUsed: string;
  effectiveGasPrice: string;
  gasUsed: string;
};

export type EVMDecodedLogEvent = {
  logIndex: string;
  signature: string;
  solidityDef?: string;
  address: string;
  data: object;
};

export type EVMDecodedError = {
  signature: string;
  solidityDef: string;
  data: string;
};

export type EVMDecodedFunctionInput = {
  signature: string;
  solidityDef?: string;
  data: string;
};

export type EVMNativeETHTransfer = {
  from: string;
  to: string;
  value: string;
  /** Identifies the call in the nested trace stack; empty array for root-level transfers. */
  traceAddress?: number[];
};
