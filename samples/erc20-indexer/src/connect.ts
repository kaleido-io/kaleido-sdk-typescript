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

import { IndexerConfig, formatError } from '@kaleido-io/sdk';
import { ERC20Indexer } from './erc20/indexer.js';
import type { ERC20Config } from './config/provider-config.js';

const config = IndexerConfig.loadFromFile<ERC20Config>();
const erc20Indexer = new ERC20Indexer(config);
erc20Indexer.connect().catch((err: any) => {
  console.error(formatError(err));
  process.exit(1);
});
