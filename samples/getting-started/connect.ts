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
  WorkflowEngineClient,
  createDirectedTransactionHandler,
  type ServiceClientOptions,
} from "@kaleido-io/workflow-engine-sdk";
import { AssetManagerClient } from "@kaleido-io/asset-manager-sdk";
import dotenv from "dotenv";

import { actionMap as helloActionMap } from "./hello/handlers.js";
import { actionMap as httpInvokeActionMap } from "./http-invoke/handlers.js";
import { eventSource } from "./event-source/event-source.js";
import { echoHandlerDef } from "./event-source/event-processor.js";
import { eventSource as dealerEventSource } from "./snap/event-source.js";
import { actionMap as snapActionMap } from "./snap/snap-handler.js";
import { createActionMap as createListPoolsActionMap } from "./list-pools/handlers.js";

dotenv.config();

// The list-pools handler creates a per-invocation AM client so that each
// transaction's authRef is forwarded to the proxy for bearer-token injection.
// The base options are captured during setup (after the WFE client is built
// but before the WebSocket connects) and shared via closure.
const listPoolsRegistration = (() => {
  let amOptions!: ServiceClientOptions;
  return {
    setup: async (ctx: { getServiceClientOptions(name: string): ServiceClientOptions }) => {
      amOptions = ctx.getServiceClientOptions('asset-manager');
    },
    handler: createDirectedTransactionHandler(
      'list-pools',
      createListPoolsActionMap(
        (authRef?) => new AssetManagerClient({ ...amOptions, authRef } as ServiceClientOptions),
      ),
    ),
  };
})();

const app = WorkflowEngineClient.fromConfigFile()
  .transactionHandler('hello', { handler: createDirectedTransactionHandler('hello', helloActionMap) })
  .transactionHandler('http-invoke', { handler: createDirectedTransactionHandler('http-invoke', httpInvokeActionMap) })
  .transactionHandler('snap-watcher', { handler: createDirectedTransactionHandler('snap-watcher', snapActionMap) })
  .transactionHandler('list-pools', listPoolsRegistration)
  .indexer('echo', echoHandlerDef)
  .eventSource(eventSource)
  .eventSource(dealerEventSource);

process.on('SIGINT', () => app.stop());
process.on('SIGTERM', () => app.stop());

await app.start();
