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

import axios, { AxiosInstance, CreateAxiosDefaults } from "axios";
import { WorkflowEngineClient, WorkflowEngineClientConfig } from "../client/client";
import { configureHttpClient, HttpClientOptions } from "../service";
import { kidColon } from "../utils/kidutils";
import { newLogger } from "../log/logger";

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

const log = newLogger("ProviderBase");

export class ProviderBase<CustomConfig> {

    constructor(private providerConfig: ProviderConfig<CustomConfig>) {}

    async createClient(): Promise<WorkflowEngineClient> {
        // Connect to the workflow engine
        const platformURLWsScheme = this.getPlatformURL().replace(/^http/, 'ws');;
        const wsURL = `${platformURLWsScheme}${this.getWorkflowEngineRESTEndpoint()}/ws`;
        if (!this.providerConfig.providerName) {
            throw new Error(`providerName is required`);
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

    getPlatformURL(): string {
        const platformURL = this.providerConfig.platform?.url?.replace(/\/+$/, '');
        if (!platformURL) {
            throw new Error(`platform.url is required`);
        }
        return platformURL;
    }

    newPlatformClient(urlPrefix: string): AxiosInstance {
        const config: CreateAxiosDefaults<any> = {
            baseURL: `${this.getPlatformURL()}/${urlPrefix.replace(/^\/+/, '')}`,
        }
        log.debug(`Created client to ${config.baseURL}`);
        const { username, password } = this.providerConfig.platform?.auth || {};
        if (username && password) {
            config.auth = {username, password};
        }
        const axiosInstance = axios.create(config);
        return configureHttpClient(axiosInstance, this.providerConfig.platform)
    }

    getWorkflowEngineRESTEndpoint(): string {
        const {
            environmentNameOrId,
            workflowEngineNameOrId
        } = this.providerConfig;
        if (!environmentNameOrId || !workflowEngineNameOrId) {
            throw new Error(`environmentNameOrId, workflowEngineNameOrId are required`);
        }
        return `/endpoint/${kidColon('e', environmentNameOrId)}/${kidColon('s', workflowEngineNameOrId)}/rest`;
    }
}
