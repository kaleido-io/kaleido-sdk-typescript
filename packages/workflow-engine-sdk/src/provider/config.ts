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

import { HttpClientOptions } from "../service";
import { promises as fs } from 'fs';
import * as yaml from "js-yaml";

export interface PlatformConfig extends HttpClientOptions {
    url?: string;
}

export interface ProviderConfig<CustomConfig> {

    platform?: PlatformConfig;

    providerName?: string;

    environmentNameOrId?: string;

    workflowEngineNameOrId?: string;

    config?: CustomConfig;

}
export interface IndexerConfig<CustomConfig> extends ProviderConfig<CustomConfig> {

    connectorNameOrId?: string;

    assetManagerNameOrId?: string;

    handlerName?: string; // defaults to 'indexer'

    stream?: {
        autoCreate?: boolean;
        factory?: string;
        name?: string;
        description?: string;
        eventSourceConfig?: any; // we user server-side validation here
    };

}

export async function loadYAML<T>(configPath?: string): Promise<T> {
    configPath = configPath ?? process.env.WFE_CONFIG_FILE ?? './config/config.yaml';
    const raw = await fs.readFile(configPath, "utf8");
    return yaml.load(raw) as T; // this is just an simple type assertion (not schema validation)
}

export function kidColon(prefix: string, value: string): string {
    return prefix.replace(new RegExp(`^${prefix}-`), `${prefix}:`);
}
export function kidDash(prefix: string, value: string): string {
    return prefix.replace(new RegExp(`^${prefix}:`), `${prefix}-`);
}