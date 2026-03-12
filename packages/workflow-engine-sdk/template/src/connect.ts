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

import * as fs from "fs";
import {
  newDirectedTransactionHandler,
  WorkflowEngineClient,
  NewWorkflowEngineClient,
  HandlerSetFor,
} from "@kaleido-io/workflow-engine-sdk";
import dotenv from "dotenv";

import provider from "./provider.js";

import { actionMap as helloActionMap } from "./samples/hello/handlers.js";
import { actionMap as httpInvokeActionMap } from "./samples/http-invoke/handlers.js";
import { eventSource } from "./samples/event-source/event-source.js";
import { actionMap as snapActionMap } from "./samples/snap/snap-handler.js";
import { echoEventProcessor } from "./samples/event-source/event-processor.js";
import { eventSource as dealerEventSource } from "./samples/snap/event-source.js";

dotenv.config();

const helloHandler = newDirectedTransactionHandler("hello", helloActionMap);
const httpInvokeHandler = newDirectedTransactionHandler(
  "http-invoke",
  httpInvokeActionMap,
);
const snapHandler = newDirectedTransactionHandler(
  "snap-watcher",
  snapActionMap,
);

let client: WorkflowEngineClient;

client = await NewWorkflowEngineClient(
  HandlerSetFor(
    helloHandler,
    httpInvokeHandler,
    echoEventProcessor,
    eventSource,
    snapHandler,
    dealerEventSource,
  ),
);

process.on("SIGINT", () => client.disconnect());
process.on("SIGTERM", () => client.disconnect());
