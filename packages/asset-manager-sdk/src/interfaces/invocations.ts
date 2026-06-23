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

import type { KldResourceBase } from './common.js';

export type InvocationStatus =
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "suspended";

export type InvocationType = "api" | "subscription" | "eventstream";

export type InvocationOutcome =
  | "sync_submitted"
  | "sync_invoked"
  | "sync_failed"
  | "sync_duplicate"
  | "sync_blocked"
  | "async_submitted"
  | "async_duplicate";

export interface InvocationInput {
  idempotencyKey?: string;
  async?: boolean;
  activity?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  input?: any;
  retryCondition?: string;
  variableSets?: string[];
}

export interface InvocationResult {
  contentType?: string;
  jsonEncoding?: string;
  data?: any;
  info?: any;
  context?: any;
}

export interface Invocation extends KldResourceBase {
  type?: InvocationType;
  parentId?: string;
  identity?: string;
  identityContext?: any;
  status?: InvocationStatus;
  result?: InvocationResult;
  errorCount?: number;
  invokedVersion?: string;
  startTime?: string;
  lastError?: string;
  lastErrorText?: string;
  idempotencyKey?: string;
  async?: boolean;
  activity?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  input?: any;
  retryCondition?: string;
  variableSets?: string[];
}

export interface InvocationSubmitResult {
  outcome: InvocationOutcome;
  duplicate?: string;
  id?: string;
  error?: string;
  errorDetail?: string;
  context?: any;
  retryable?: boolean;
  contentType?: string;
  jsonEncoding?: string;
  data?: any;
  info?: any;
}

export interface StepsCatalogItem {
  name?: string;
  type?: string;
  options?: any;
}
