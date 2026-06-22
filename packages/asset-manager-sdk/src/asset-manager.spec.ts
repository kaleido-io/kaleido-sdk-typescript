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
import { ServiceTransport } from '@kaleido-io/core/http';
import { AssetManagerClient } from './asset-manager.js';

jest.mock('@kaleido-io/core/http', () => ({
    ...(jest.requireActual('@kaleido-io/core/http') as object),
    createServiceTransport: jest.fn(() => mockTransport),
}));

const mockGet = jest.fn<ServiceTransport['get']>();
const mockPost = jest.fn<ServiceTransport['post']>();
const mockPut = jest.fn<ServiceTransport['put']>();
const mockPatch = jest.fn<ServiceTransport['patch']>();
const mockDelete = jest.fn<ServiceTransport['delete']>();
const mockTransport = { get: mockGet, post: mockPost, put: mockPut, patch: mockPatch, delete: mockDelete };

const V1 = '/api/v1';

describe('AssetManagerClient', () => {
    let client: AssetManagerClient;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new AssetManagerClient({ transport: 'http', url: 'http://localhost' });
    });

    describe('Status', () => {
        it('getStatus calls GET /api/v1/status', () => {
            client.getStatus();
            expect(mockTransport.get).toHaveBeenCalledWith(`${V1}/status`, undefined, undefined);
        });
    });

    describe('Assets', () => {
        it('getAssets calls GET /api/v1/assets with no params', () => {
            client.getAssets();
            expect(mockTransport.get).toHaveBeenCalledWith(`${V1}/assets`, undefined, undefined);
        });

        it('getAssets passes filter as params', () => {
            const filter = { name: 'my-asset' };
            client.getAssets({ filter });
            expect(mockTransport.get).toHaveBeenCalledWith(`${V1}/assets`, filter, undefined);
        });

        it('getAsset passes ignore404', () => {
            client.getAsset('my-asset');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/assets/my-asset`,
                undefined,
                { ignore404: true },
            );
        });

        it('createAsset calls POST /api/v1/assets', () => {
            const asset = { name: 'my-asset' };
            client.createAsset(asset);
            expect(mockTransport.post).toHaveBeenCalledWith(`${V1}/assets`, asset, undefined);
        });

        it('updateAsset calls PATCH /api/v1/assets/:id', () => {
            const updates = { description: 'new desc' };
            client.updateAsset('my-asset', updates);
            expect(mockTransport.patch).toHaveBeenCalledWith(`${V1}/assets/my-asset`, updates, undefined);
        });

        it('deleteAsset calls DELETE /api/v1/assets/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteAsset('my-asset');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/assets/my-asset`, undefined, undefined);
        });
    });

    describe('Balances', () => {
        it('getAddressBalances calls GET /api/v1/addresses/:address/balances', () => {
            client.getAddressBalances('0xabc');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/addresses/0xabc/balances`,
                undefined,
                undefined,
            );
        });

        it('getAssetBalances calls GET /api/v1/assets/:id/balances', () => {
            client.getAssetBalances('my-asset');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/assets/my-asset/balances`,
                undefined,
                undefined,
            );
        });

        it('getPoolBalances calls GET /api/v1/pools/:id/balances', () => {
            client.getPoolBalances('my-pool');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/pools/my-pool/balances`,
                undefined,
                undefined,
            );
        });
    });

    describe('bulkQuery', () => {
        it('calls POST /api/v1/bulk/query with retryOn5xx', async () => {
            const input = { assets: {} };
            mockPost.mockResolvedValue({ assets: { count: 3 } });
            await client.bulkQuery(input as any);
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/bulk/query`,
                input,
                { retryOn5xx: true },
            );
        });

        it('returns the response from the transport', async () => {
            const response = { assets: { items: [], count: 0 } };
            mockPost.mockResolvedValue(response);
            const result = await client.bulkQuery({} as any);
            expect(result).toBe(response);
        });
    });

    describe('bulkUpsert', () => {
        it('calls PUT /api/v1/bulk/datamodel', async () => {
            const input = { assets: [{ name: 'a' }] };
            mockPut.mockResolvedValue({});
            await client.bulkUpsert(input as any);
            expect(mockPut).toHaveBeenCalledWith(
                `${V1}/bulk/datamodel`,
                input,
                undefined,
            );
        });

        it('forwards AxiosRequestConfig options to the transport', async () => {
            mockPut.mockResolvedValue({});
            const options = { timeout: 5000 };
            await client.bulkUpsert({} as any, options);
            expect(mockPut).toHaveBeenCalledWith(
                `${V1}/bulk/datamodel`,
                {},
                options,
            );
        });
    });

    describe('Policies', () => {
        it('getPolicy omits withActive param when not provided', () => {
            client.getPolicy('my-policy');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/policies/my-policy`,
                { withActive: undefined },
                { ignore404: true },
            );
        });

        it('getPolicy passes withActive: true', () => {
            client.getPolicy('my-policy', { withActive: true });
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/policies/my-policy`,
                { withActive: true },
                { ignore404: true },
            );
        });

        it('invokePolicy calls POST /api/v1/policies/:id/invoke', () => {
            const input = { foo: 'bar' };
            client.invokePolicy('my-policy', input);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/invoke`,
                input,
                undefined,
            );
        });

        it('invokeInlinePolicy calls POST /api/v1/inline/policy/invoke', () => {
            const policy = { name: 'p', version: {} } as any;
            client.invokeInlinePolicy(policy);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/inline/policy/invoke`,
                policy,
                undefined,
            );
        });
    });

    describe('Policy Versions', () => {
        it('createPolicyVersion omits params when inactive is not provided', () => {
            const version = { name: 'v1' } as any;
            client.createPolicyVersion('my-policy', version);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions`,
                version,
                { params: undefined },
            );
        });

        it('createPolicyVersion passes inactive param when provided', () => {
            const version = { name: 'v1' } as any;
            client.createPolicyVersion('my-policy', version, { inactive: true });
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions`,
                version,
                { params: { inactive: true } },
            );
        });

        it('invokePolicyVersion calls the versioned invoke endpoint', () => {
            client.invokePolicyVersion('my-policy', 'v1', {});
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions/v1/invoke`,
                {},
                undefined,
            );
        });
    });

    describe('Tasks', () => {
        it('getTask omits withActive param when not provided', () => {
            client.getTask('my-task');
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/tasks/my-task`,
                undefined,
                { ignore404: true },
            );
        });

        it('getTask passes withActive: true', () => {
            client.getTask('my-task', { withActive: true });
            expect(mockTransport.get).toHaveBeenCalledWith(
                `${V1}/tasks/my-task`,
                { withActive: true },
                { ignore404: true },
            );
        });

        it('invokeTask omits returnFullContext param when not provided', () => {
            const input = {} as any;
            client.invokeTask('my-task', input);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/invoke`,
                input,
                { params: undefined },
            );
        });

        it('invokeTask passes returnFullContext param when provided', () => {
            const input = {} as any;
            client.invokeTask('my-task', input, { returnFullContext: true });
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/invoke`,
                input,
                { params: { returnFullContext: true } },
            );
        });

        it('invokeInlineTask passes returnFullContext param when provided', () => {
            const task = {} as any;
            client.invokeInlineTask(task, { returnFullContext: false });
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/inline/task/invoke`,
                task,
                { params: { returnFullContext: false } },
            );
        });
    });

    describe('Subscriptions', () => {
        it('subscriptionStart calls POST .../start', () => {
            client.subscriptionStart('my-sub');
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/subscriptions/my-sub/start`,
                {},
                undefined,
            );
        });

        it('subscriptionStop calls POST .../stop', () => {
            client.subscriptionStop('my-sub');
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/subscriptions/my-sub/stop`,
                {},
                undefined,
            );
        });

        it('subscriptionReset calls POST .../reset with request body', () => {
            const request = { fromSequence: 0 } as any;
            client.subscriptionReset('my-sub', request);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/subscriptions/my-sub/reset`,
                request,
                undefined,
            );
        });
    });

    describe('Invocations', () => {
        it('invocationFail calls POST .../fail', () => {
            const error = { message: 'something went wrong' };
            client.invocationFail('inv-1', error);
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/invocations/inv-1/fail`,
                error,
                undefined,
            );
        });

        it('invocationReplay calls POST .../replay', () => {
            client.invocationReplay('inv-1');
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/invocations/inv-1/replay`,
                {},
                undefined,
            );
        });

        it('invocationSuspend calls POST .../suspend', () => {
            client.invocationSuspend('inv-1');
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/invocations/inv-1/suspend`,
                {},
                undefined,
            );
        });

        it('invocationResume calls POST .../resume', () => {
            client.invocationResume('inv-1');
            expect(mockTransport.post).toHaveBeenCalledWith(
                `${V1}/invocations/inv-1/resume`,
                {},
                undefined,
            );
        });
    });

    describe('Addresses', () => {
        it('getAddresses calls GET /api/v1/addresses', () => {
            client.getAddresses();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/addresses`, undefined, undefined);
        });

        it('getAddresses passes filter', () => {
            const filter = { address: '0xabc' };
            client.getAddresses({ filter });
            expect(mockGet).toHaveBeenCalledWith(`${V1}/addresses`, filter, undefined);
        });

        it('getAddress passes ignore404', () => {
            client.getAddress('0xabc');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/addresses/0xabc`, undefined, { ignore404: true });
        });

        it('createAddress calls POST /api/v1/addresses', () => {
            const address = { address: '0xabc' } as any;
            client.createAddress(address);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/addresses`, address, undefined);
        });

        it('updateAddress calls PATCH /api/v1/addresses/:address', () => {
            client.updateAddress('0xabc', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/addresses/0xabc`, { description: 'new' }, undefined);
        });

        it('deleteAddress calls DELETE /api/v1/addresses/:address', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteAddress('0xabc');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/addresses/0xabc`, undefined, undefined);
        });
    });

    describe('Pools', () => {
        it('getPools calls GET /api/v1/pools', () => {
            client.getPools();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/pools`, undefined, undefined);
        });

        it('getPool passes ignore404', () => {
            client.getPool('my-pool');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/pools/my-pool`, undefined, { ignore404: true });
        });

        it('createPool calls POST /api/v1/pools', () => {
            const pool = { name: 'my-pool' } as any;
            client.createPool(pool);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/pools`, pool, undefined);
        });

        it('updatePool calls PATCH /api/v1/pools/:id', () => {
            client.updatePool('my-pool', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/pools/my-pool`, { description: 'new' }, undefined);
        });

        it('deletePool calls DELETE /api/v1/pools/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deletePool('my-pool');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/pools/my-pool`, undefined, undefined);
        });
    });

    describe('Collections', () => {
        it('getCollections calls GET /api/v1/collections', () => {
            client.getCollections();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/collections`, undefined, undefined);
        });

        it('getCollection passes ignore404', () => {
            client.getCollection('my-col');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/collections/my-col`, undefined, { ignore404: true });
        });

        it('createCollection calls POST /api/v1/collections', () => {
            const col = { name: 'my-col' };
            client.createCollection(col);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/collections`, col, undefined);
        });

        it('updateCollection calls PATCH /api/v1/collections/:id', () => {
            client.updateCollection('my-col', { displayName: 'My Col' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/collections/my-col`, { displayName: 'My Col' }, undefined);
        });

        it('deleteCollection calls DELETE /api/v1/collections/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteCollection('my-col');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/collections/my-col`, undefined, undefined);
        });
    });

    describe('Activities', () => {
        it('getActivities calls GET /api/v1/activities', () => {
            client.getActivities();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/activities`, undefined, undefined);
        });

        it('getActivity passes ignore404', () => {
            client.getActivity('my-activity');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/activities/my-activity`, undefined, { ignore404: true });
        });

        it('createActivity calls POST /api/v1/activities', () => {
            const activity = { name: 'my-activity' } as any;
            client.createActivity(activity);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/activities`, activity, undefined);
        });

        it('updateActivity calls PATCH /api/v1/activities/:id', () => {
            client.updateActivity('my-activity', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/activities/my-activity`, { description: 'new' }, undefined);
        });

        it('deleteActivity calls DELETE /api/v1/activities/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteActivity('my-activity');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/activities/my-activity`, undefined, undefined);
        });
    });

    describe('Data', () => {
        it('getData calls GET /api/v1/data', () => {
            client.getData();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/data`, undefined, undefined);
        });

        it('getDataSingle passes ignore404', () => {
            client.getDataSingle('my-data');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/data/my-data`, undefined, { ignore404: true });
        });

        it('createData calls POST /api/v1/data', () => {
            const data = { name: 'my-data' } as any;
            client.createData(data);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/data`, data, undefined);
        });

        it('updateData calls PATCH /api/v1/data/:id', () => {
            client.updateData('my-data', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/data/my-data`, { description: 'new' }, undefined);
        });

        it('deleteData calls DELETE /api/v1/data/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteData('my-data');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/data/my-data`, undefined, undefined);
        });
    });

    describe('Events', () => {
        it('getEvents calls GET /api/v1/events', () => {
            client.getEvents();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/events`, undefined, undefined);
        });

        it('getEvent passes ignore404', () => {
            client.getEvent('ev-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/events/ev-1`, undefined, { ignore404: true });
        });

        it('createEvent calls POST /api/v1/events', () => {
            const event = { name: 'ev-1' } as any;
            client.createEvent(event);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/events`, event, undefined);
        });

        it('updateEvent calls PATCH /api/v1/events/:id', () => {
            client.updateEvent('ev-1', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/events/ev-1`, { description: 'new' }, undefined);
        });

        it('deleteEvent calls DELETE /api/v1/events/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteEvent('ev-1');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/events/ev-1`, undefined, undefined);
        });
    });

    describe('Fragments', () => {
        it('getFragments calls GET /api/v1/fragments', () => {
            client.getFragments();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/fragments`, undefined, undefined);
        });

        it('getFragment passes ignore404', () => {
            client.getFragment('frag-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/fragments/frag-1`, undefined, { ignore404: true });
        });

        it('createFragment calls POST /api/v1/fragments', () => {
            const fragment = { name: 'frag-1' } as any;
            client.createFragment(fragment);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/fragments`, fragment, undefined);
        });

        it('updateFragment calls PATCH /api/v1/fragments/:id', () => {
            client.updateFragment('frag-1', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/fragments/frag-1`, { description: 'new' }, undefined);
        });

        it('deleteFragment calls DELETE /api/v1/fragments/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteFragment('frag-1');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/fragments/frag-1`, undefined, undefined);
        });
    });

    describe('NFTs', () => {
        it('getNFTs calls GET /api/v1/nfts', () => {
            client.getNFTs();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/nfts`, undefined, undefined);
        });

        it('getNFT passes ignore404', () => {
            client.getNFT('nft-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/nfts/nft-1`, undefined, { ignore404: true });
        });

        it('createNFT calls POST /api/v1/nfts', () => {
            const nft = { name: 'nft-1' } as any;
            client.createNFT(nft);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/nfts`, nft, undefined);
        });

        it('updateNFT calls PATCH /api/v1/nfts/:id', () => {
            client.updateNFT('nft-1', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/nfts/nft-1`, { description: 'new' }, undefined);
        });

        it('deleteNFT calls DELETE /api/v1/nfts/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteNFT('nft-1');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/nfts/nft-1`, undefined, undefined);
        });
    });

    describe('Transfers', () => {
        it('getTransfers calls GET /api/v1/transfers', () => {
            client.getTransfers();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/transfers`, undefined, undefined);
        });

        it('getTransfer passes ignore404', () => {
            client.getTransfer('tx-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/transfers/tx-1`, undefined, { ignore404: true });
        });

        it('createTransfer calls POST /api/v1/transfers', () => {
            const transfer = { name: 'tx-1' } as any;
            client.createTransfer(transfer);
            expect(mockPost).toHaveBeenCalledWith(`${V1}/transfers`, transfer, undefined);
        });

        it('updateTransfer calls PATCH /api/v1/transfers/:id', () => {
            client.updateTransfer('tx-1', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/transfers/tx-1`, { description: 'new' }, undefined);
        });

        it('deleteTransfer calls DELETE /api/v1/transfers/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteTransfer('tx-1');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/transfers/tx-1`, undefined, undefined);
        });
    });

    describe('Balances (remaining)', () => {
        it('getBalances calls GET /api/v1/balances', () => {
            client.getBalances();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/balances`, undefined, undefined);
        });

        it('getBalance passes ignore404', () => {
            client.getBalance('bal-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/balances/bal-1`, undefined, { ignore404: true });
        });
    });

    describe('Policies (remaining)', () => {
        it('getPolicies calls GET /api/v1/policies', () => {
            client.getPolicies();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/policies`, undefined, undefined);
        });

        it('replacePolicy calls PUT /api/v1/policies/:id', () => {
            const policy = { name: 'p', version: {} } as any;
            client.replacePolicy('my-policy', policy);
            expect(mockPut).toHaveBeenCalledWith(`${V1}/policies/my-policy`, policy, undefined);
        });

        it('updatePolicy calls PATCH /api/v1/policies/:id', () => {
            client.updatePolicy('my-policy', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/policies/my-policy`, { description: 'new' }, undefined);
        });

        it('deletePolicy calls DELETE /api/v1/policies/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deletePolicy('my-policy');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/policies/my-policy`, undefined, undefined);
        });
    });

    describe('Policy Versions (remaining)', () => {
        it('getPolicyVersions calls GET /api/v1/policies/:id/versions', () => {
            client.getPolicyVersions('my-policy');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/policies/my-policy/versions`, undefined, undefined);
        });

        it('getPolicyVersion passes ignore404', () => {
            client.getPolicyVersion('my-policy', 'v1');
            expect(mockGet).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions/v1`,
                undefined,
                { ignore404: true },
            );
        });

        it('updatePolicyVersion calls PATCH /api/v1/policies/:id/versions/:version', () => {
            client.updatePolicyVersion('my-policy', 'v1', { description: 'new' } as any);
            expect(mockPatch).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions/v1`,
                { description: 'new' },
                undefined,
            );
        });

        it('deletePolicyVersion calls DELETE /api/v1/policies/:id/versions/:version', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deletePolicyVersion('my-policy', 'v1');
            expect(mockDelete).toHaveBeenCalledWith(
                `${V1}/policies/my-policy/versions/v1`,
                undefined,
                undefined,
            );
        });
    });

    describe('Tasks (remaining)', () => {
        it('getTasks calls GET /api/v1/tasks', () => {
            client.getTasks();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/tasks`, undefined, undefined);
        });

        it('replaceTask calls PUT /api/v1/tasks/:id', () => {
            const task = { name: 'my-task' } as any;
            client.replaceTask('my-task', task);
            expect(mockPut).toHaveBeenCalledWith(`${V1}/tasks/my-task`, task, undefined);
        });

        it('updateTask calls PATCH /api/v1/tasks/:id', () => {
            client.updateTask('my-task', { description: 'new' });
            expect(mockPatch).toHaveBeenCalledWith(`${V1}/tasks/my-task`, { description: 'new' }, undefined);
        });

        it('deleteTask calls DELETE /api/v1/tasks/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteTask('my-task');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/tasks/my-task`, undefined, undefined);
        });
    });

    describe('Task Versions', () => {
        it('getTaskVersions calls GET /api/v1/tasks/:id/versions', () => {
            client.getTaskVersions('my-task');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/tasks/my-task/versions`, undefined, undefined);
        });

        it('getTaskVersion passes ignore404', () => {
            client.getTaskVersion('my-task', 'v1');
            expect(mockGet).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions/v1`,
                undefined,
                { ignore404: true },
            );
        });

        it('createTaskVersion omits params when inactive not provided', () => {
            const version = { name: 'v1' } as any;
            client.createTaskVersion('my-task', version);
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions`,
                version,
                { params: undefined },
            );
        });

        it('createTaskVersion passes inactive param when provided', () => {
            const version = { name: 'v1' } as any;
            client.createTaskVersion('my-task', version, { inactive: true });
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions`,
                version,
                { params: { inactive: true } },
            );
        });

        it('updateTaskVersion calls PATCH /api/v1/tasks/:id/versions/:version', () => {
            client.updateTaskVersion('my-task', 'v1', { description: 'new' } as any);
            expect(mockPatch).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions/v1`,
                { description: 'new' },
                undefined,
            );
        });

        it('deleteTaskVersion calls DELETE /api/v1/tasks/:id/versions/:version', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteTaskVersion('my-task', 'v1');
            expect(mockDelete).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions/v1`,
                undefined,
                undefined,
            );
        });

        it('invokeTaskVersion omits returnFullContext when not provided', () => {
            client.invokeTaskVersion('my-task', 'v1', {} as any);
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions/v1/invoke`,
                {},
                { params: undefined },
            );
        });

        it('invokeTaskVersion passes returnFullContext when provided', () => {
            client.invokeTaskVersion('my-task', 'v1', {} as any, { returnFullContext: true });
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/tasks/my-task/versions/v1/invoke`,
                {},
                { params: { returnFullContext: true } },
            );
        });
    });

    describe('Invocations (remaining)', () => {
        it('getInvocations calls GET /api/v1/invocations', () => {
            client.getInvocations();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/invocations`, undefined, undefined);
        });

        it('getInvocation passes ignore404', () => {
            client.getInvocation('inv-1');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/invocations/inv-1`, undefined, { ignore404: true });
        });

        it('deleteInvocation calls DELETE /api/v1/invocations/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteInvocation('inv-1');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/invocations/inv-1`, undefined, undefined);
        });
    });

    describe('Steps Catalog', () => {
        it('getStepsCatalog calls GET /api/v1/steps/catalog', () => {
            client.getStepsCatalog();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/steps/catalog`, undefined, undefined);
        });
    });

    describe('Subscriptions (remaining)', () => {
        it('getSubscriptions calls GET /api/v1/subscriptions', () => {
            client.getSubscriptions();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/subscriptions`, undefined, undefined);
        });

        it('getSubscription passes ignore404', () => {
            client.getSubscription('my-sub');
            expect(mockGet).toHaveBeenCalledWith(`${V1}/subscriptions/my-sub`, undefined, { ignore404: true });
        });

        it('replaceSubscription calls PUT /api/v1/subscriptions/:id', () => {
            const sub = { name: 'my-sub' } as any;
            client.replaceSubscription('my-sub', sub);
            expect(mockPut).toHaveBeenCalledWith(`${V1}/subscriptions/my-sub`, sub, undefined);
        });

        it('deleteSubscription calls DELETE /api/v1/subscriptions/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteSubscription('my-sub');
            expect(mockDelete).toHaveBeenCalledWith(`${V1}/subscriptions/my-sub`, undefined, undefined);
        });
    });

    describe('Data Model Listeners', () => {
        it('getDataModelListeners calls GET /api/v1/listeners/datamodel', () => {
            client.getDataModelListeners();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/listeners/datamodel`, undefined, undefined);
        });

        it('getDataModelListener passes ignore404', () => {
            client.getDataModelListener('my-listener');
            expect(mockGet).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener`,
                undefined,
                { ignore404: true },
            );
        });

        it('replaceDataModelListener calls PUT /api/v1/listeners/datamodel/:id', () => {
            const listener = { name: 'my-listener' } as any;
            client.replaceDataModelListener('my-listener', listener);
            expect(mockPut).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener`,
                listener,
                undefined,
            );
        });

        it('deleteDataModelListener calls DELETE /api/v1/listeners/datamodel/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteDataModelListener('my-listener');
            expect(mockDelete).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener`,
                undefined,
                undefined,
            );
        });

        it('dataModelListenerStart calls POST .../start', () => {
            client.dataModelListenerStart('my-listener');
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener/start`,
                {},
                undefined,
            );
        });

        it('dataModelListenerStop calls POST .../stop', () => {
            client.dataModelListenerStop('my-listener');
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener/stop`,
                {},
                undefined,
            );
        });

        it('dataModelListenerReset calls POST .../reset with request body', () => {
            const request = { fromSequence: 0 } as any;
            client.dataModelListenerReset('my-listener', request);
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/listeners/datamodel/my-listener/reset`,
                request,
                undefined,
            );
        });
    });

    describe('FireFly Listeners', () => {
        it('getFireFlyListeners calls GET /api/v1/listeners/firefly', () => {
            client.getFireFlyListeners();
            expect(mockGet).toHaveBeenCalledWith(`${V1}/listeners/firefly`, undefined, undefined);
        });

        it('getFireFlyListener passes ignore404', () => {
            client.getFireFlyListener('my-listener');
            expect(mockGet).toHaveBeenCalledWith(
                `${V1}/listeners/firefly/my-listener`,
                undefined,
                { ignore404: true },
            );
        });

        it('replaceFireFlyListener calls PUT /api/v1/listeners/firefly/:id', () => {
            const listener = { name: 'my-listener' } as any;
            client.replaceFireFlyListener('my-listener', listener);
            expect(mockPut).toHaveBeenCalledWith(
                `${V1}/listeners/firefly/my-listener`,
                listener,
                undefined,
            );
        });

        it('deleteFireFlyListener calls DELETE /api/v1/listeners/firefly/:id', async () => {
            mockDelete.mockResolvedValue(undefined);
            await client.deleteFireFlyListener('my-listener');
            expect(mockDelete).toHaveBeenCalledWith(
                `${V1}/listeners/firefly/my-listener`,
                undefined,
                undefined,
            );
        });

        it('fireflyListenerStart calls POST .../start', () => {
            client.fireflyListenerStart('my-listener');
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/listeners/firefly/my-listener/start`,
                {},
                undefined,
            );
        });

        it('fireflyListenerStop calls POST .../stop', () => {
            client.fireflyListenerStop('my-listener');
            expect(mockPost).toHaveBeenCalledWith(
                `${V1}/listeners/firefly/my-listener/stop`,
                {},
                undefined,
            );
        });
    });
});
