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

import axios, { AxiosInstance } from "axios";
import { WorkflowEngineClient, WorkflowEngineClientConfig } from "../client/client";
import { configureHttpClient } from "../service";
import { kidColon, ProviderConfig } from "./config";

export class ProviderBase<CustomConfig> {

    constructor(private providerConfig: ProviderConfig<CustomConfig>) {}

    async createClient(): Promise<WorkflowEngineClient> {
        // Connect to the workflow engine
        const wsURL = `${this.getWorkflowEngineRESTEndpoint()}/ws`;
        if (!this.providerConfig.providerName) {
            throw new Error(`providerName and platform.url are required`);
        }
        const wfeConfig: WorkflowEngineClientConfig = {
            url: wsURL,
            providerName: this.providerConfig.providerName,
        }
        if (this.providerConfig.platform?.auth?.username) {
            const { username, password } = this.providerConfig.platform.auth;
            wfeConfig.authHeaderName = 'Authorization';
            wfeConfig.headers = {
                'Authorization': `basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`
            };
        }
        return new WorkflowEngineClient(wfeConfig);
     }

    newPlatformClient(urlPrefix: string): AxiosInstance {
        const platformURL = this.providerConfig.platform?.url;
        if (!platformURL) {
            throw new Error(`platform.url is required`);
        }
        const axiosInstance = axios.create({ baseURL: `${platformURL.replace(/\/+$/, '')}/${urlPrefix.replace(/^\/+/, '')}` });
        return configureHttpClient(axiosInstance, this.providerConfig.platform)
    }

    getWorkflowEngineRESTEndpoint(): string {
        const {
            environmentNameOrId,
            workflowEngineNameOrId
        } = this.providerConfig;
        const platformURL = this.providerConfig.platform?.url;
        if (!environmentNameOrId || !workflowEngineNameOrId) {
            throw new Error(`environmentNameOrId, workflowEngineNameOrId are required`);
        }
        return `/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', workflowEngineNameOrId)}/rest`;
    }

}