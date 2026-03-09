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


import { EventSourceConf, EventSourceEvent, newEventSource, newLogger, WSEventStreamInfo } from "@kaleido-io/workflow-engine-sdk";

const log = newLogger('event-source');

// Example event source handler using the factory
interface MyEventSourceConfig {
  pollingInterval: number;
}

interface MyEventSourceCheckpoint {
  lastPollTime: number;
}

interface MyEventData {
  message: string;
  timestamp: number;
}

export const eventSource = newEventSource<MyEventSourceCheckpoint, MyEventSourceConfig, MyEventData>(
  'my-listener',
  async (config: EventSourceConf<MyEventSourceConfig>, checkpoint: MyEventSourceCheckpoint | null) => {
    log.info('Polling for events with config:', config.config);

    const now = Date.now();
    let lastPollTime = checkpoint?.lastPollTime || now;
    const events: EventSourceEvent<MyEventData>[] = [];
    if (now - lastPollTime > 10000) {
      const timestamp = now;
      events.push({
        idempotencyKey: `event-${timestamp}`,
        topic: 'my-topic',
        data: { message: `Hello from event source at ${new Date(timestamp).toISOString()}`, timestamp }
      });
      lastPollTime = now;
    }

    return {
      checkpointOut: { lastPollTime },
      events
    };
  }
)
  .withInitialCheckpoint(async () => ({
    lastPollTime: 0
  }))
  .withConfigParser(async (_, config: MyEventSourceConfig) => {
    return {
      pollingInterval: config.pollingInterval || 5000
    };
  })
  .withDeleteFn(async (info: WSEventStreamInfo) => {
    log.info(`Cleaning up event source ${info.streamName} (${info.streamId})`);
  });