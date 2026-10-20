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

/**
 * An event source that emits one event per interval. Paired with the engine's transaction_dispatch processor
 * (see stream.ts) it runs a workflow on a schedule.
 *
 * The file depends only on @kaleido-io/workflow-engine-sdk and @kaleido-io/core-sdk, so it can be registered
 * in your own provider with `client.eventSource(scheduledSource)`, or uploaded unchanged as a TypeScript provider
 * snippet and listed under `eventSources` in the service config.
 */
import { newLogger } from '@kaleido-io/core-sdk/log';
import { defineEventSource } from '@kaleido-io/workflow-engine-sdk';

const log = newLogger('scheduled-source');

interface ScheduleConfig {
  intervalMs: number;
}

interface ScheduleCheckpoint {
  lastEmitTime: number;
}

interface ScheduleEvent extends Record<string, unknown> {
  scheduledAt: string;
}

const DEFAULT_INTERVAL_MS = 60_000;

/** Change this to build the payload each tick. It may be async, for example to call an API. */
async function buildEvent(now: number): Promise<ScheduleEvent> {
  return { scheduledAt: new Date(now).toISOString() };
}

export const scheduledSource = defineEventSource<ScheduleCheckpoint, ScheduleConfig, ScheduleEvent>('scheduled-source', {
  poll: async ({ config, checkpoint, stream }) => {
    const now = Date.now();
    const lastEmitTime = checkpoint?.lastEmitTime ?? now;
    if (now - lastEmitTime < config.intervalMs) {
      return { checkpoint: { lastEmitTime } };
    }

    log.info(`Emitting scheduled event for stream ${stream.streamName}`);
    return {
      checkpoint: { lastEmitTime: now },
      events: [
        {
          // Scoped to the stream so two streams sharing this source never collide.
          idempotencyKey: `${stream.streamId}-${now}`,
          topic: 'schedule',
          data: await buildEvent(now),
        },
      ],
    };
  },
  // The first event fires one interval after the stream starts.
  initialCheckpoint: () => ({ lastEmitTime: Date.now() }),
  parseConfig: (_stream, config: Partial<ScheduleConfig> | undefined) => {
    const intervalMs = config?.intervalMs;
    if (intervalMs === undefined) {
      return { intervalMs: DEFAULT_INTERVAL_MS };
    }
    if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error(`intervalMs must be a positive integer number of milliseconds (got ${JSON.stringify(intervalMs)})`);
    }
    return { intervalMs };
  },
  onDelete: (stream) => {
    log.info(`Scheduled source removed from stream ${stream.streamName}`);
  },
});
