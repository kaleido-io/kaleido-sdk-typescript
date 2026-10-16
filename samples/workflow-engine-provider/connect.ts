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
  createTransactionHandler,
} from "@kaleido-io/workflow-engine-sdk";
import dotenv from "dotenv";

import { actionMap as helloActionMap } from "./hello/handlers.js";
import { actionMap as httpInvokeActionMap } from "./http-invoke/handlers.js";
import { eventSource as scheduledSource } from "./scheduled-workflow/scheduled-source.js";
import { processBatch as echoProcessor } from "./scheduled-workflow/echo-processor.js";
import { eventSource as dealerEventSource } from "./snap/event-source.js";
import { actionMap as snapActionMap } from "./snap/snap-handler.js";
import { actionMap as listPoolsActionMap } from "./list-pools/handlers.js";

dotenv.config();

const app = WorkflowEngineClient.fromConfigFile()
  .transactionHandler('hello', { handler: createTransactionHandler('hello', helloActionMap) })
  .transactionHandler('http-invoke', { handler: createTransactionHandler('http-invoke', httpInvokeActionMap) })
  .transactionHandler('snap-watcher', { handler: createTransactionHandler('snap-watcher', snapActionMap) })
  .transactionHandler('list-pools', { handler: createTransactionHandler('list-pools', listPoolsActionMap) })
  .eventProcessor('echo', echoProcessor)
  .eventSource(scheduledSource)
  .eventSource(dealerEventSource);

process.on('SIGINT', () => app.stop());
process.on('SIGTERM', () => app.stop());

await app.start();
