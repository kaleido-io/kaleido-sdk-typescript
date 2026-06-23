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

import type { Fragment } from '@kaleido-io/asset-manager-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import type { InputSpec } from '@kaleido-io/connector-sdk/btc';
import {
  createTransactionHandler,
  EvalResult,
  InvocationMode,
  SetupContext,
  TransactionHandlerBatchIn,
  TransactionHandlerBatchOut,
  TransactionHandlerRegistration,
  WithStageDirector,
} from '@kaleido-io/workflow-engine-sdk';

export interface BTCCoinSelectorConfig {
  tokenName: string;
  bulkQueryLimit?: number;
}

export interface BTCCoinSelectorInput extends WithStageDirector {
  walletAddress: string;
  amountSat: number;
}

export interface BTCCoinSelectorOutput {
  inputs: InputSpec[];
  totalSat: number;
}

// Selects a single coin (UTXO) by picking the largest available value.
// Swap this function out to implement smarter strategies (e.g. exact-match, smallest-sufficient).
// Note: values are compared via Number(), which loses precision above 2^53
// satoshis (~90M BTC) — fine for this sample, but use BigInt for exact ordering.
export function selectLargestCoin(fragments: Fragment[]): Fragment | undefined {
  if (fragments.length === 0) return undefined;
  return fragments.reduce((best, f) =>
    Number(f.value ?? '0') > Number(best.value ?? '0') ? f : best,
  );
}

export function createCoinSelectorHandler(): TransactionHandlerRegistration {
  let setupCtx: SetupContext<BTCCoinSelectorConfig>;

  const handler = createTransactionHandler<BTCCoinSelectorInput>(
    'btc-coin-selector',
    new Map([
      ['selectCoins', {
        invocationMode: InvocationMode.BATCH,
        batchHandler: async (
          transactions: TransactionHandlerBatchIn<BTCCoinSelectorInput>[],
        ): Promise<TransactionHandlerBatchOut[]> => {
          const { tokenName, bulkQueryLimit = 100 } = setupCtx.config;
          const am = new AssetManagerClient(setupCtx);

          return Promise.all(transactions.map(async ({ value: input }): Promise<TransactionHandlerBatchOut> => {
            const result = await am.bulkQuery({
              fragments: {
                limit: bulkQueryLimit,
                eq: [{ field: 'address', value: tokenName }],
                labels: {
                  eq: [{ field: 'ownerAddress', value: input.walletAddress }],
                  null: [{ field: 'spend_tx' }],
                },
              },
            });

            const coin = selectLargestCoin(result.fragments?.items ?? []);

            if (!coin?.info) {
              return {
                result: EvalResult.HARD_FAILURE,
                error: new Error(`No spendable UTXOs for address ${input.walletAddress}`),
              };
            }

            // fragment.info is the TxSummaryVOut stored by the indexer, plus txid/block fields
            const utxo = coin.info as { txid: string; n: number; scriptPubKey?: { hex: string } };
            const inputSpec: InputSpec = {
              txid: utxo.txid,
              vout: utxo.n,
              scriptPubKey: utxo.scriptPubKey?.hex ?? '',
              valueSat: Number(coin.value),
            };

            const output: BTCCoinSelectorOutput = {
              inputs: [inputSpec],
              totalSat: Number(coin.value ?? 0),
            };

            return { result: EvalResult.COMPLETE, output };
          }));
        },
      }],
    ]),
  );

  return {
    setup: async (ctx) => {
      setupCtx = ctx as SetupContext<BTCCoinSelectorConfig>;
    },
    handler,
  };
}
