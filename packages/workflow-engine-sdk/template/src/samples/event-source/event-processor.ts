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

import { EngineAPI, WSEventProcessorBatchRequest, WSEventProcessorBatchResult } from "@kaleido-io/workflow-engine-sdk";

export class MyEventProcessor {

    constructor() { }

    name(): string {
        return 'echo';
    }

    init(_engAPI: EngineAPI): Promise<void> {
        return Promise.resolve();
    }

    close(): void {
        return;
    }

    eventProcessorBatch(result: WSEventProcessorBatchResult, batch: WSEventProcessorBatchRequest): Promise<void> {
        for (const event of batch.events) {
            console.log(`Event received: ${event.topic} - ${JSON.stringify(event.data, null, '\t')}`);
        }
        result.checkpoint = {
            lastPollTime: Date.now()
        };
        return Promise.resolve();
    }
}

export const echoEventProcessor = new MyEventProcessor();
