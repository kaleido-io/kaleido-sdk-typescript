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

import { createEventSource } from '@kaleido-io/workflow-engine-sdk';

interface ScheduleConfig {
  intervalMs: number;
}

interface ScheduleCheckpoint {
  lastEmitTime: number;
}

/** Emits one event per interval. The stream's config sets intervalMs (default one minute). */
export const eventSource = createEventSource<ScheduleCheckpoint, ScheduleConfig, { scheduledAt: string }>(
  'schedule',
  async (conf, checkpoint) => {
    const now = Date.now();
    const lastEmitTime = checkpoint?.lastEmitTime ?? now;
    if (now - lastEmitTime < conf.config.intervalMs) {
      return { checkpointOut: { lastEmitTime }, events: [] };
    }
    return {
      checkpointOut: { lastEmitTime: now },
      // The stream ID keeps events from two streams on this source apart.
      events: [{ idempotencyKey: `${conf.streamId}-${now}`, topic: 'schedule', data: { scheduledAt: new Date(now).toISOString() } }],
    };
  },
)
  .withInitialCheckpoint(async () => ({ lastEmitTime: Date.now() }))
  .withConfigParser(async (_info, config: Partial<ScheduleConfig> | undefined) => ({ intervalMs: config?.intervalMs ?? 60_000 }));
