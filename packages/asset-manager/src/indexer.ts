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

import { createEventProcessor, EventProcessorEvent, kidColon, newLogger, RequestContext } from "@kaleido-io/workflow-engine-sdk";
import { IDataModelClient } from "./bulk-upsert-builder";
import { ProviderAssetMgrBase, ProviderAssetMgrConfig } from "./provider-asset-mgr-base";

export interface IndexerConfig<CustomConfig> extends ProviderAssetMgrConfig<CustomConfig> {

    connectorNameOrId?: string;

    handlerName?: string; // defaults to 'indexer'

    stream?: {
        autoCreate?: boolean;
        factory?: string;
        name?: string;
        description?: string;
        eventSourceConfig?: any; // we use server-side validation here
    };

}

const log = newLogger("Indexer");

export abstract class Indexer<CustomConfig, EventDataType> extends ProviderAssetMgrBase<CustomConfig> {

    constructor(private esConfig: IndexerConfig<CustomConfig>) {
        super(esConfig);
    }

    abstract setup(
        config: CustomConfig,
    ): Promise<void>;

    abstract indexBatch(
        reqContext: RequestContext,
        events: EventProcessorEvent<EventDataType>[],
    ): Promise<void>;

    private async process(reqContext: RequestContext, events: EventProcessorEvent<EventDataType>[]): Promise<void> {
        return await this.indexBatch(reqContext, events);
    }

    async connect() {
        // Create/update the stream if requested
        if (this.esConfig.stream?.autoCreate) {
            await this.ensureStream();
        }

        // Create the client
        const wfeClient = await super.createClient();

        // Call the setup function
        if (!this.esConfig.config) {
            throw new Error('Config is required');
        }
        await this.setup(this.esConfig.config);

        // Register our indexer
        wfeClient.registerEventProcessor(this.handlerName(), createEventProcessor(this.handlerName(), this.process.bind(this)));

        // Connect
        await wfeClient.connect();
    }

    getConnectorServiceDetail(): { environmentNameOrId: string, connectorNameOrId: string } {
        const {
            environmentNameOrId,
            connectorNameOrId
        } = this.esConfig;
        if (!environmentNameOrId || !connectorNameOrId) {
            throw new Error(`environmentNameOrId, connectorNameOrId are required`);
        }
        return {environmentNameOrId, connectorNameOrId};
    }

    getConnectorRESTEndpoint(): string {
        const {environmentNameOrId, connectorNameOrId} = this.getConnectorServiceDetail();
        return `/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', connectorNameOrId)}/rest`;
    }

    handlerName(): string {
        return this.esConfig.handlerName || 'indexer';
    }

    async ensureStream() {

        const connectorClient = this.newPlatformClient(this.getConnectorRESTEndpoint());

        const {
            factory,
            name,
            eventSourceConfig,
            description,
        } = this.esConfig.stream || {};
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
                handler: {
                    config: eventSourceConfig,
                }
            }
        };
        log.info(`Upserting stream '${name}' on factory ${factory}:\n${JSON.stringify(streamToCreate, null, '  ')}`);
        const {data: stream} = await connectorClient.put(`/api/v1/stream-factories/${factory}/api/streams/${name}`, streamToCreate);
        log.info(`Stream ID: ${stream.id}`);

    }

}
