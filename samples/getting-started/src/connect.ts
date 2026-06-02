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
  createDirectedTransactionHandler,
  NewWorkflowEngineClient,
  HandlerSetFor,
} from "@kaleido-io/workflow-engine-sdk";
import { AssetManagerClient } from "@kaleido-io/asset-manager-sdk";
import { ServiceClientOptions } from "@kaleido-io/core/http";
import dotenv from "dotenv";

import { actionMap as helloActionMap } from "./samples/hello/handlers.js";
import { actionMap as httpInvokeActionMap } from "./samples/http-invoke/handlers.js";
import { eventSource } from "./samples/event-source/event-source.js";
import { actionMap as snapActionMap } from "./samples/snap/snap-handler.js";
import { echoEventProcessor } from "./samples/event-source/event-processor.js";
import { eventSource as dealerEventSource } from "./samples/snap/event-source.js";
import { createActionMap as createListPoolsActionMap } from "./samples/list-pools/handlers.js";

dotenv.config();

const configFile = process.env.WFE_CONFIG_FILE ?? "./config/wfe-config.yaml";

const helloHandler = createDirectedTransactionHandler("hello", helloActionMap);
const httpInvokeHandler = createDirectedTransactionHandler(
  "http-invoke",
  httpInvokeActionMap,
);
const snapHandler = createDirectedTransactionHandler(
  "snap-watcher",
  snapActionMap,
);

// baseAmOptions is set after connect() resolves, before any WebSocket messages
// are dispatched. The factory creates a per-invocation client with the
// transaction's authRef so the proxy can attach the correct bearer token.
let baseAmOptions: ServiceClientOptions;
const listPoolsHandler = createDirectedTransactionHandler(
  "list-pools",
  createListPoolsActionMap((authRef?) => new AssetManagerClient({ ...baseAmOptions, authRef } as ServiceClientOptions)),
);

const client = await NewWorkflowEngineClient(
  HandlerSetFor(
    helloHandler,
    httpInvokeHandler,
    echoEventProcessor,
    eventSource,
    snapHandler,
    dealerEventSource,
    listPoolsHandler,
  ),
  configFile,
);

baseAmOptions = client.getServiceClientOptions("asset-manager");

process.on("SIGINT", () => client.disconnect());
process.on("SIGTERM", () => client.disconnect());
