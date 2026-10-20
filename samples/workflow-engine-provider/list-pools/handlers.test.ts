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

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EvalResult } from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';
import { listPoolsHandler } from './handlers.js';

// A stand-in Asset Manager. The action's client calls it through the binding
// options passed to invokeAction, so the test runs the real client code.
let server: Server | undefined;
const requests: string[] = [];

async function fakeAssetManager(pools: { name: string }[]): Promise<string> {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items: pools }));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
  requests.length = 0;
});

describe('list-pools handler', () => {
  it('returns the pools from the Asset Manager binding', async () => {
    const url = await fakeAssetManager([{ name: 'pool-a' }, { name: 'pool-b' }]);

    const result = await invokeAction(listPoolsHandler, 'list-pools', {}, {
      bindings: { 'asset-manager': { transport: 'http', url } },
    });

    expect(requests).toEqual(['GET /api/v1/pools']);
    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ pools: [{ name: 'pool-a' }, { name: 'pool-b' }] });
    expect(result.customStage).toBeUndefined();
  });

  it('moves to the no-pools stage when there are none', async () => {
    const url = await fakeAssetManager([]);

    const result = await invokeAction(listPoolsHandler, 'list-pools', {}, {
      bindings: { 'asset-manager': { transport: 'http', url } },
    });

    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ pools: [] });
    expect(result.customStage).toBe('no-pools');
  });
});
