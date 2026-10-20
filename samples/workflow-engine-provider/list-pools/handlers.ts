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

import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';
import { complete, defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

export const listPoolsHandler = defineTransactionHandler({
  // The context resolves the 'asset-manager' binding as the transaction's caller,
  // so with a hosted binding the provider proxy calls the Asset Manager with
  // their credentials. No setup hook is needed.
  'list-pools': async (_input, ctx) => {
    const assetManager = new AssetManagerClient(ctx, 'asset-manager');
    const pools = (await assetManager.getPools())?.items ?? [];
    // With no pools, finish in the flow's 'no-pools' stage instead of nextStage.
    if (pools.length === 0) {
      return complete({ pools }, { stage: 'no-pools' });
    }
    return { pools };
  },
});
