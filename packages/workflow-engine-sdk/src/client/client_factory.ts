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

import { WorkflowEngineClient, WorkflowEngineClientConfig } from "./client";
import { ConfigLoader } from "../config/config";
import { newError, SDKErrors } from "../i18n/errors";
import {
  TransactionHandler,
  EventSource,
  EventProcessor,
  Handler,
} from "../interfaces/handlers";

/*
 * A set of handlers to register with the runtime
 */
export type HandlerSet = ReadonlyArray<
  TransactionHandler | EventSource | EventProcessor
>;

function isTransactionHandler(h: Handler): h is TransactionHandler {
  return (
    typeof (h as TransactionHandler).transactionHandlerBatch === "function"
  );
}

function isEventSource(h: Handler): h is EventSource {
  return typeof (h as EventSource).eventSourcePoll === "function";
}

function isEventProcessor(h: Handler): h is EventProcessor {
  return typeof (h as EventProcessor).eventProcessorBatch === "function";
}

/**
 * Build a handler set from one or more handlers
 */
export function HandlerSetFor(
  ...handlers: Array<TransactionHandler | EventSource | EventProcessor>
): HandlerSet {
  return handlers;
}

/**
 * Create and start a handler provider.
 * Loads WFE config from file when configFile or WFE_CONFIG_FILE is set,
 * then creates the client, registers all handlers, connects, and returns the provider.
 */
export async function NewWorkflowEngineClient(
  handlerSet: HandlerSet,
  configFile?: string /** Path to WFE config file; if empty, process.env[WFE_CONFIG_FILE] is used. */,
): Promise<WorkflowEngineClient> {
  let clientConfig: WorkflowEngineClientConfig;

  clientConfig = ConfigLoader.loadClientConfigFromFile(configFile);
  const client = new WorkflowEngineClient(clientConfig);

  for (const handler of handlerSet) {
    const name = handler.name();
    if (isTransactionHandler(handler)) {
      client.registerTransactionHandler(name, handler);
    } else if (isEventSource(handler)) {
      client.registerEventSource(name, handler);
    } else if (isEventProcessor(handler)) {
      client.registerEventProcessor(name, handler);
    } else {
      throw newError(SDKErrors.MsgSDKHandlerInvalidType, name);
    }
  }

  await client.connect();
  return client;
}
