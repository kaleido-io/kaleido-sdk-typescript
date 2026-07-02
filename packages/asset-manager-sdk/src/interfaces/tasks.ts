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

export interface Task extends KldResourceBase {
  name?: string;
  currentVersion?: string;
  description?: string;
  variableSet?: string;
}

export interface TaskInlineVersion extends Task {
  version?: string;
  steps?: any[];
}

export interface TaskInlineInvoke extends TaskInlineVersion {
  input?: any;
}

export interface TaskVersion extends KldResourceBase {
  name?: string;
  taskId?: string;
  steps?: any[];
  exampleInput?: string;
  description?: string;
}

export interface TaskVersionUpdate {
  description?: string;
}

export interface TaskVersionInfo {
  name?: string;
  version?: string;
  hash?: string;
}

export interface TaskInvocationResult {
  task?: TaskVersionInfo;
  result?: any;
}
