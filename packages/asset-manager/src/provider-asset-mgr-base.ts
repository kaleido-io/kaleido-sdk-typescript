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

import { kidColon, ProviderBase, ProviderConfig, WorkflowEngineClient } from "@kaleido-io/workflow-engine-sdk";
import { AssetManagerClient } from "./asset-manager";
import { IDataModelClient } from "./bulk-upsert-builder";

export interface ProviderAssetMgrConfig<CustomConfig> extends ProviderConfig<CustomConfig> {
    assetManagerNameOrId?: string;
}

export abstract class ProviderAssetMgrBase<CustomConfig> extends ProviderBase<CustomConfig> {

    /**
     * Sub-classes register their handlers and perform other initialization in this callback.
     * @param wfeClient The client ready to initialize, before connection
     */
    abstract setupWorkflowEngine(wfeClient: WorkflowEngineClient): Promise<void>;

    protected readonly dmClient: IDataModelClient;

    constructor(private pdmConfig: ProviderAssetMgrConfig<CustomConfig>) {
        super(pdmConfig);
        this.dmClient = this.newAssetManagerClient();
    }

    newAssetManagerClient(): IDataModelClient {
        const {
            environmentNameOrId,
            assetManagerNameOrId,
        } = this.pdmConfig;
        if (!environmentNameOrId || !assetManagerNameOrId) {
            throw new Error(`environmentNameOrId, assetManagerNameOrId are required`);
        }
        const url = `${this.getPlatformURL()}/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', assetManagerNameOrId)}/rest`;

        return new AssetManagerClient({
            ...this.pdmConfig.platform,
            transport: 'http',
            url,
            auth: { type: 'basic', ...this.pdmConfig.platform?.auth },
        });
    }

    async connect() {
        // Create the client
        const wfeClient = await super.createClient();

        // Call the setup function
        await this.setupWorkflowEngine(wfeClient);

        // Connect
        await wfeClient.connect();
    }

}
