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
 * TypeScript types mirroring the Go btctypes package in btcconnect.
 * Source: pkg/btctypes/tranasction_spec.go (and related files)
 */

// Script type strings as used by Bitcoin Core's decodescript RPC and btcd
export type ScriptType =
  | 'nonstandard'
  | 'pubkey'              // Pay-to-Public-Key (long form)
  | 'p2pk'               // Pay-to-Public-Key
  | 'pubkeyhash'         // Pay-to-Public-Key-Hash (long form)
  | 'p2pkh'              // Pay-to-Public-Key-Hash
  | 'multisig'           // Pay-to-Multisig (long form)
  | 'p2ms'               // Pay-to-Multisig
  | 'scripthash'         // Pay-to-Script-Hash (long form)
  | 'p2sh'               // Pay-to-Script-Hash
  | 'witness_v0_keyhash'    // Pay-to-Witness-Public-Key-Hash (long form)
  | 'p2wpkh'                // Pay-to-Witness-Public-Key-Hash — native SegWit
  | 'witness_v0_scripthash' // Pay-to-Witness-Script-Hash (long form)
  | 'p2wsh'                 // Pay-to-Witness-Script-Hash — native SegWit variant of P2SH
  | 'witness_v1_taproot'    // Pay-to-Taproot (long form)
  | 'p2tr'                  // Pay-to-Taproot — Schnorr signatures / BIP-341
  | 'nulldata';             // OP_RETURN output

// See https://developer.bitcoin.org/devguide/transactions.html?highlight=sighash
export type SignatureHashType =
  | 'all'                  // signs all inputs and outputs (default)
  | 'none'                 // signs all inputs, no outputs — outputs can be changed
  | 'single'               // signs all inputs and the output at the same index as this input
  | 'all_anyone_can_pay'   // signs all outputs, only this input — other inputs can be added
  | 'none_anyone_can_pay'  // signs only this input — outputs and other inputs can be changed
  | 'single_anyone_can_pay'; // signs this input and its corresponding output

// A key available for auto-matching to inputs by public key
export type AvailableKey = {
  keyIdentifier: string; // how to refer to this key in a signing request
  publicKey: string;     // DER encoded base64, or hex 33/65 byte compressed/uncompressed
};

// The on-chain output point being spent as an input
export type OutPointSpec = {
  txid: string;          // transaction hash in TXID string order (not little-endian wire format)
  vout: number;          // output index within that transaction
  valueSat?: number;     // value of the UTXO in satoshis
  value?: number | string; // value in BTC (json.Number — use valueSat where possible)
  scriptPubKey: string;  // hex-encoded locking script of the UTXO being spent
};

// Precalculated scriptSig / witness — bypass signing and validation
export type InputSpecPrecalc = {
  signatureScript?: string; // hex-encoded signature script
  witness?: string[];       // hex-encoded witness stack items
};

// An instruction to spend a single on-chain UTXO
export type InputSpec = OutPointSpec & {
  sigHashType?: SignatureHashType;
  nSequence?: number;          // input sequence number (for RBF / relative locktime)
  redeemScript?: string;       // hex-encoded redeem script (P2SH / P2WSH)
  internalPubKey?: string;     // hex-encoded x-only internal public key (Taproot)
  scriptParams?: string[];     // hex-encoded extra parameters pushed onto the script stack
  precalculated?: InputSpecPrecalc; // if set, scriptSig/witness taken as-is, no validation
};

// A spender for an output — identified by address or public key
export type Spender = {
  address?: string;
  publicKey?: string; // DER encoded base64, or hex 33/65 byte compressed/uncompressed
};

// A destination output to create in the transaction
export type OutputSpec = {
  value?: number | string; // value in BTC (json.Number — use valueSat where possible)
  valueSat?: number;       // value in satoshis
  scriptType?: ScriptType;
  spenders?: Spender[];    // addresses / public keys that can spend this output
  numRequired?: number;    // minimum signatures required (multisig)
  redeemScript?: string;   // hex-encoded redeem script (P2SH / P2WSH)
  data?: string;           // hex-encoded data payload (nulldata / OP_RETURN outputs)
};

// A precise, fully-resolved Bitcoin transaction specification.
// All input/output values and fee must be pre-calculated by the caller.
// The connector re-verifies these figures and returns the results for analysis (e.g. max fee check).
export type TransactionSpec = {
  availableKeys?: AvailableKey[]; // keys supplied once; auto-matched by public key to inputs
  inputs: InputSpec[];            // UTXOs to spend
  outputs: OutputSpec[];          // new UTXOs to create
  lockTime?: number;              // BIP-68: block height (<500000000) or Unix timestamp when final
};
