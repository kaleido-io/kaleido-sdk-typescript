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

import * as path from "path";
import { kidColon, newLogger, ProviderBase } from "@kaleido-io/workflow-engine-sdk";
import { loadConfig } from "./config/config.js";
import { createAssetManagerClient, IndexerConfig, IndexerSnippetDef } from "./indexer/indexer.js";
import { createSnippetIndexer } from "./indexer/snippet.js";

const log = newLogger("MultiSnippetProvider");

export interface SnippetEntry {
    name: string;
    path: string;
    connectorNameOrId?: string;
    stream?: {
        autoCreate?: boolean;
        factory?: string;
        name?: string;
        description?: string;
        eventSourceConfig?: unknown;
    };
}

export interface SnippetManifest {
    snippets: SnippetEntry[];
}

type LoadedSnippet = {
    entry: SnippetEntry;
    indexer: ReturnType<typeof createSnippetIndexer>;
};

export class MultiSnippetProvider extends ProviderBase<never> {

    private platformConfig: IndexerConfig<never>;

    constructor() {
        const platformConfig = IndexerConfig.loadFromFile<never>();
        super(platformConfig);
        this.platformConfig = platformConfig;
    }

    /**
     * Validate all snippets without connecting to the WFE.
     * Exits cleanly if all pass; throws on first structural error.
     * Intended for use as a deployment gate: node provider.js --validate
     */
    async validate(): Promise<void> {
        const manifest = this.loadManifest();
        await this.loadAndValidate(manifest);
        log.info(`All ${manifest.snippets.length} snippet(s) valid`);
    }

    /**
     * Full startup: validate → initialise → register → connect.
     */
    async run(): Promise<void> {
        const manifest = this.loadManifest();
        const loaded = await this.loadAndValidate(manifest);

        const amClient = createAssetManagerClient(this.platformConfig);

        // Create streams before connecting
        for (const { entry, indexer: _ } of loaded) {
            if (entry.stream?.autoCreate) {
                await this.ensureStream(entry);
            }
        }

        const wfeClient = await this.createClient();

        // Initialise (setup()) and register each snippet
        for (const { entry, indexer } of loaded) {
            log.info(`Initialising snippet '${entry.name}'`);
            await indexer.initialize(amClient);
            wfeClient.registerEventProcessor(entry.name, indexer.asEventProcessor(amClient));
            log.info(`Registered snippet '${entry.name}'`);
        }

        await wfeClient.connect();
    }

    private loadManifest(): SnippetManifest {
        const manifestPath = process.env['CONFIG_FILE'];
        if (!manifestPath) {
            throw new Error('CONFIG_FILE env var is required for MultiSnippetProvider (snippet manifest path)');
        }
        return loadConfig<SnippetManifest>(manifestPath);
    }

    private async loadAndValidate(manifest: SnippetManifest): Promise<LoadedSnippet[]> {
        // Unique name check
        const seen = new Set<string>();
        for (const entry of manifest.snippets) {
            if (seen.has(entry.name)) {
                throw new Error(`Duplicate snippet name: '${entry.name}'`);
            }
            seen.add(entry.name);
        }

        const loaded: LoadedSnippet[] = [];
        for (const entry of manifest.snippets) {
            const resolved = path.resolve(entry.path);
            log.info(`Loading snippet '${entry.name}' from ${resolved}`);

            const mod = await import(resolved) as Record<string, unknown>;

            if (typeof mod.indexBatch !== 'function') {
                throw new Error(`Snippet '${entry.name}' (${resolved}): must export an indexBatch function`);
            }
            if (mod.setup !== undefined && typeof mod.setup !== 'function') {
                throw new Error(`Snippet '${entry.name}' (${resolved}): setup export must be a function`);
            }

            loaded.push({
                entry,
                indexer: createSnippetIndexer(entry.name, mod as unknown as IndexerSnippetDef),
            });
        }
        return loaded;
    }

    private async ensureStream(entry: SnippetEntry): Promise<void> {
        const { stream, name, connectorNameOrId } = entry;
        if (!connectorNameOrId) {
            throw new Error(`Snippet '${name}': connectorNameOrId is required when stream.autoCreate is true`);
        }
        const { factory, name: streamName, eventSourceConfig, description } = stream!;
        if (!factory || !streamName || !eventSourceConfig) {
            throw new Error(`Snippet '${name}': stream.factory, stream.name, and stream.eventSourceConfig are required for autoCreate`);
        }

        const envId = this.platformConfig.environmentNameOrId!;
        const connectorEndpoint = `/endpoint/${kidColon('e', envId)}/${kidColon('s', connectorNameOrId)}/rest`;
        const connectorClient = this.newPlatformClient(connectorEndpoint);

        const streamToCreate = {
            description,
            eventProcessor: {
                type: 'handler',
                handler: {
                    provider: this.platformConfig.providerName,
                    name,
                },
            },
            eventSource: {
                type: 'handler',
                handler: { config: eventSourceConfig },
            },
        };

        log.info(`Upserting stream '${streamName}' for snippet '${name}' on factory ${factory}`);
        const { data: created } = await connectorClient.put(
            `/api/v1/stream-factories/${factory}/api/streams/${streamName}`,
            streamToCreate,
        );
        log.info(`Stream '${streamName}' ID: ${created.id}`);
    }
}
