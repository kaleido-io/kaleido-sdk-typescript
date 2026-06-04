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

import { createEventProcessor, EventProcessorEvent, kidColon, Logger, newLogger, ProviderBase, ProviderConfig, RequestContext } from "@kaleido-io/workflow-engine-sdk";
import { AssetManagerClient, BulkUpsertBuilder, IDataModelClient } from "@kaleido-io/asset-manager-sdk";
import { loadConfig } from "../config/config.js";


export interface IndexerConfig<CustomConfig> extends ProviderConfig<CustomConfig> {

    connectorNameOrId?: string;

    assetManagerNameOrId?: string;

    handlerName?: string; // defaults to 'indexer'

    stream?: {
        autoCreate?: boolean;
        factory?: string;
        name?: string;
        description?: string;
        eventSourceConfig?: any; // we use server-side validation here
    };

}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace IndexerConfig {
    export function loadFromFile<T>(configFilePath?: string): IndexerConfig<T> {
        return loadConfig<IndexerConfig<T>>(configFilePath);
    }
}

/**
 * Context object passed to snippet setup() and indexBatch() functions.
 * Provides AM access, BulkUpsertBuilder, and logging without requiring imports.
 */
export interface IndexerContext {
    am: IDataModelClient;
    BulkUpsertBuilder: typeof BulkUpsertBuilder;
    log: Logger;
}

/**
 * The shape a snippet module must export.
 */
export interface IndexerSnippetDef {
    setup?: (ctx: IndexerContext) => Promise<void>;
    indexBatch: (
        events: EventProcessorEvent<unknown>[],
        ctx: IndexerContext,
    ) => Promise<{ events: EventProcessorEvent<unknown>[] }>;
}

/**
 * Create an Asset Manager client from an IndexerConfig.
 * Extracted so both Indexer and MultiSnippetProvider can use it without duplication.
 */
export function createAssetManagerClient(config: IndexerConfig<unknown>): IDataModelClient {
    const { environmentNameOrId, assetManagerNameOrId } = config;
    if (!environmentNameOrId || !assetManagerNameOrId) {
        throw new Error('environmentNameOrId, assetManagerNameOrId are required');
    }
    const platformURL = config.platform?.url?.replace(/\/+$/, '');
    if (!platformURL) {
        throw new Error('platform.url is required');
    }
    const url = `${platformURL}/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', assetManagerNameOrId)}/rest`;
    return new AssetManagerClient({
        ...config.platform,
        transport: 'http',
        url,
        auth: { type: 'basic', ...config.platform?.auth },
    });
}

const log = newLogger("Indexer");

export abstract class Indexer<CustomConfig, EventDataType> extends ProviderBase<CustomConfig> {

    private readonly dmClient: IDataModelClient;

    constructor(private esConfig: IndexerConfig<CustomConfig>) {
        super(esConfig);
        this.dmClient = createAssetManagerClient(esConfig);
    }

    abstract setup(
        config: CustomConfig,
        dmClient: IDataModelClient,
    ): Promise<void>;

    abstract indexBatch(
        reqContext: RequestContext,
        events: EventProcessorEvent<EventDataType>[],
        dmClient: IDataModelClient,
    ): Promise<{ events: EventProcessorEvent<EventDataType>[] }>;

    private async process(reqContext: RequestContext, events: EventProcessorEvent<EventDataType>[]): Promise<{ events: EventProcessorEvent<EventDataType>[] }> {
        return await this.indexBatch(reqContext, events, this.dmClient);
    }

    /**
     * Returns a named event processor that can be registered on a shared WorkflowEngineClient.
     * Does not open a WS connection — use this when combining multiple indexers in one provider.
     * connect() uses this internally for the standalone case.
     */
    asEventProcessor(amClient: IDataModelClient): ReturnType<typeof createEventProcessor> {
        return createEventProcessor(
            this.handlerName(),
            (reqContext, events) => this.indexBatch(reqContext, events as EventProcessorEvent<EventDataType>[], amClient),
        );
    }

    async connect() {
        if (this.esConfig.stream?.autoCreate) {
            await this.ensureStream();
        }

        const wfeClient = await super.createClient();

        if (!this.esConfig.config) {
            throw new Error('Config is required');
        }
        await this.setup(this.esConfig.config, this.dmClient);

        wfeClient.registerEventProcessor(this.handlerName(), this.asEventProcessor(this.dmClient));

        await wfeClient.connect();
    }

    getConnectorServiceDetail(): { environmentNameOrId: string, connectorNameOrId: string } {
        const { environmentNameOrId, connectorNameOrId } = this.esConfig;
        if (!environmentNameOrId || !connectorNameOrId) {
            throw new Error(`environmentNameOrId, connectorNameOrId are required`);
        }
        return { environmentNameOrId, connectorNameOrId };
    }

    getConnectorRESTEndpoint(): string {
        const { environmentNameOrId, connectorNameOrId } = this.getConnectorServiceDetail();
        return `/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', connectorNameOrId)}/rest`;
    }

    handlerName(): string {
        return this.esConfig.handlerName || 'indexer';
    }

    async ensureStream() {
        const connectorClient = this.newPlatformClient(this.getConnectorRESTEndpoint());

        const { factory, name, eventSourceConfig, description } = this.esConfig.stream || {};
        if (!factory || !name || !eventSourceConfig) {
            throw new Error(`For stream.autoCreate, stream.factory, stream.name and stream.eventSourceConfig are required`);
        }

        const streamToCreate = {
            description,
            eventProcessor: {
                type: 'handler',
                handler: {
                    provider: this.esConfig.providerName,
                    name: this.handlerName(),
                },
            },
            eventSource: {
                type: 'handler',
                handler: { config: eventSourceConfig },
            },
        };
        log.info(`Upserting stream '${name}' on factory ${factory}:\n${JSON.stringify(streamToCreate, null, '  ')}`);
        const { data: stream } = await connectorClient.put(`/api/v1/stream-factories/${factory}/api/streams/${name}`, streamToCreate);
        log.info(`Stream ID: ${stream.id}`);
    }

}
