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

import * as fs from "fs";
import yaml from "js-yaml";
import { KALEIDO_CONFIG_FILE } from "@kaleido-io/workflow-engine-sdk";

const LEGACY_CONFIG_FILE = "CONFIG_FILE";

/**
 * Load a typed config object from a YAML file.
 *
 * Resolution order for the file path:
 *   1. explicit `configFilePath` argument
 *   2. KALEIDO_CONFIG_FILE environment variable
 *   3. CONFIG_FILE environment variable (backward compat)
 *   4. ./config/config.yaml (default)
 *
 * This is the general-purpose loader. Use it directly for non-indexer providers,
 * or indirectly via IndexerConfig.loadFromFile() for indexer providers.
 */
export function loadConfig<T>(configFilePath?: string): T {
    const resolvedPath = (
        configFilePath ??
        process.env[KALEIDO_CONFIG_FILE] ??
        process.env[LEGACY_CONFIG_FILE] ??
        "./config/config.yaml"
    ).trim();
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid config file: ${resolvedPath}`);
    }
    return parsed as T;
}
