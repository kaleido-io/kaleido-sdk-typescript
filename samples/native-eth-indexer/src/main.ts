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

import { IndexerConfig } from "@kaleido-io/asset-manager-sdk";
import { ETHIndexer } from "./indexer.js";
import { ETHIndexerConfig } from "./config.js";

import yaml from 'js-yaml';
import fs from 'fs';
import { formatError } from "@kaleido-io/workflow-engine-sdk";

// Synchronously load config and export the indexer
const configPath = process.env.CONFIG_FILE ?? './config/config.yaml';
const config: IndexerConfig<ETHIndexerConfig> = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any;
const ethIndexer = new ETHIndexer(config);
ethIndexer.connect().catch((err: any) => {
    console.error(formatError(err));
    process.exit(1);
});
