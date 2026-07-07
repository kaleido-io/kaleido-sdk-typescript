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

import {
  createEventSource,
  type EventSourceConf,
  type EventSourceEvent,
  type WSEventStreamInfo,
} from '@kaleido-io/workflow-engine-sdk';
import { newLogger } from '@kaleido-io/core-sdk/log';

const log = newLogger('tick-source');

interface TickCheckpoint {
  lastPollTime: number;
}

interface TickEventData {
  tick: number;
  timestamp: number;
}

export const eventSource = createEventSource<TickCheckpoint, Record<string, never>, TickEventData>(
  'tick-source',
  async (_config: EventSourceConf<Record<string, never>>, checkpoint: TickCheckpoint | null) => {
    const now = Date.now();
    const lastPollTime = checkpoint?.lastPollTime ?? now;

    if (now - lastPollTime < 10_000) {
      return { checkpointOut: { lastPollTime }, events: [] };
    }

    log.info('Emitting tick event');
    const events: EventSourceEvent<TickEventData>[] = [
      {
        idempotencyKey: `tick-${now}`,
        topic: 'tick',
        data: { tick: now, timestamp: now },
      },
    ];

    return { checkpointOut: { lastPollTime: now }, events };
  },
).withInitialCheckpoint({ lastPollTime: Date.now() })
  .withDeleteFn(async () => {
    log.info('Event source deleted');
  })
  .withConfigParser(async (_reqContext, _result, request) => {
    return request.config as WSEventStreamInfo;
  });
