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

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AssetManagerClient } from './asset-manager.js';
import { ProviderAssetMgrBase, ProviderAssetMgrConfig } from './provider-with-datamodel.js';

jest.mock('./asset-manager.js');

interface TestConfig {
    someOption: string;
}

class TestProvider extends ProviderAssetMgrBase<TestConfig> {}

const baseConfig: ProviderAssetMgrConfig<TestConfig> = {
    environmentNameOrId: 'e-abcde12345',
    assetManagerNameOrId: 's-abcde12345',
    platform: { url: 'https://platform.example.com' },
    config: { someOption: 'value' },
};

describe('ProviderWithDatamodel', () => {

    beforeEach(() => {
        jest.restoreAllMocks();
    });

    describe('newAssetManagerClient()', () => {
        it('throws when environmentNameOrId is missing', () => {
            expect(() => new TestProvider({ ...baseConfig, environmentNameOrId: undefined }))
                .toThrow('environmentNameOrId, assetManagerNameOrId are required');
        });

        it('throws when assetManagerNameOrId is missing', () => {
            expect(() => new TestProvider({ ...baseConfig, assetManagerNameOrId: undefined }))
                .toThrow('environmentNameOrId, assetManagerNameOrId are required');
        });

        it('constructs AssetManagerClient with the correct URL and auth', () => {
            new TestProvider(baseConfig);
            expect(AssetManagerClient).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://platform.example.com/endpoint/e:abcde12345/s:abcde12345/rest',
                    transport: 'http',
                    auth: expect.objectContaining({ type: 'basic' }),
                })
            );
        });
    });
});
