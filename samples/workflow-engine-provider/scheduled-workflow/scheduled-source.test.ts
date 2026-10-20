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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WSMessageType, type WSListenerPollResult } from '@kaleido-io/workflow-engine-sdk';
import { scheduledSource } from './scheduled-source.js';

// Drives the source through the same poll entry point the engine uses.
async function poll(streamId: string, config: unknown, checkpoint: unknown): Promise<WSListenerPollResult> {
  const controller = new AbortController();
  const result: WSListenerPollResult = { messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT, id: 'poll', events: [] };
  await scheduledSource.eventSourcePoll(
    { requestId: 'poll', signal: controller.signal, cancel: () => controller.abort() },
    { messageType: WSMessageType.EVENT_SOURCE_CONFIG, id: 'config', streamId, streamName: 'scheduled-hello', config },
    result,
    { messageType: WSMessageType.EVENT_SOURCE_POLL, id: 'poll', streamId, streamName: 'scheduled-hello', checkpoint },
  );
  return result;
}

afterEach(() => vi.useRealTimers());

describe('scheduled-source', () => {
  it('emits nothing before the interval has elapsed', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const result = await poll('s1', { intervalMs: 5_000 }, { lastEmitTime: 999_000 });
    expect(result.events).toHaveLength(0);
    expect(result.checkpoint).toEqual({ lastEmitTime: 999_000 });
  });

  it('emits one event once the interval has elapsed, using the stream config', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const result = await poll('s2', { intervalMs: 5_000 }, { lastEmitTime: 990_000 });
    expect(result.events).toEqual([{
      idempotencyKey: 's2-1000000',
      topic: 'schedule',
      data: { scheduledAt: new Date(1_000_000).toISOString() },
    }]);
    expect(result.checkpoint).toEqual({ lastEmitTime: 1_000_000 });
  });

  it('defaults to one event a minute', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    expect((await poll('s3', {}, { lastEmitTime: 1_000_000 - 59_999 })).events).toHaveLength(0);
    expect((await poll('s4', {}, { lastEmitTime: 1_000_000 - 60_000 })).events).toHaveLength(1);
  });

  it('rejects an interval that is not a positive whole number of milliseconds', async () => {
    const result = await poll('s5', { intervalMs: '2s' }, null);
    expect(result.error).toMatch(/intervalMs must be a positive integer/);
  });

  it('starts the first interval when the stream is created', async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const validated: Record<string, unknown> = {};
    await scheduledSource.eventSourceValidateConfig({} as never, validated, { streamId: 's6', streamName: 'scheduled-hello', config: {} });
    expect(validated.initialCheckpoint).toEqual({ lastEmitTime: 2_000_000 });
  });
});
