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


import * as fastJsonPatch from "fast-json-patch";
import { PatchOp, PatchOpType, Patch } from "../types/core";

const { applyPatch } = fastJsonPatch;

export const apply = (state: unknown, patch: Patch) => {
  if (!patch || patch.length === 0) {
    return state;
  }

  const { newDocument: newState } = applyPatch(state, patch as fastJsonPatch.Operation[]);
  return newState;
};

// JSON Patch operation creators
export const addOp = (path: string, value: unknown): PatchOp => ({
  op: PatchOpType.ADD,
  path,
  value,
});

export const removeOp = (path: string): PatchOp => ({
  op: PatchOpType.REMOVE,
  path,
});

export const replaceOp = (path: string, value: unknown): PatchOp => ({
  op: PatchOpType.REPLACE,
  path,
  value,
});

export const moveOp = (from: string, path: string): PatchOp => ({
  op: PatchOpType.MOVE,
  from,
  path,
});

export const copyOp = (from: string, path: string): PatchOp => ({
  op: PatchOpType.COPY,
  from,
  path,
});

export const testOp = (path: string, value: unknown): PatchOp => ({
  op: PatchOpType.TEST,
  path,
  value,
});