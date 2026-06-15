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
 * TypeScript types for the event data produced by the `btcTransactions`
 * event source handler in the Kaleido EVM Connector.
 *
 * Import via:
 *   import type { BTCTransactionEvent } from '@kaleido-io/connector-sdk/btc';
 */

export type BlockIdentity = {
  height: number;
  hash: string;
  previousblockhash?: string;
};

export type TxSummaryScriptSig = {
  hex: string;
  type?: string;
  address?: string;
};

export type TxSummaryVIn = {
  txid: string;
  vout: number;
  value?: number;
  valueSat?: number;
  scriptSig: TxSummaryScriptSig;
  txinwitness?: string[];
  sequence: number;
};

export type TxSummaryScriptPubKey = {
  hex: string;
  address?: string;
  type: string;
};

export type TxSummaryVOut = {
  value?: number;
  valueSat?: number;
  n: number;
  scriptPubKey?: TxSummaryScriptPubKey;
  redeemScript?: string;
};

export type TxSummary = {
  txid: string;
  hash: string;
  version: number;
  size?: number;
  vsize?: number;
  weight?: number;
  locktime: number;
  vin: TxSummaryVIn[];
  vout: TxSummaryVOut[];
};

export type NetworkInfo = {
  name: string;
  net: number;
}

export type BTCTransactionEvent = {
  network: NetworkInfo;
  block: BlockIdentity;
  tx: TxSummary;
};

export * from './stream-config.js';
export { BTCConnectorClient } from './client.js';
