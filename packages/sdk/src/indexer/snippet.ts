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

import { createEventProcessor, newLogger } from "@kaleido-io/workflow-engine-sdk";
import { BulkUpsertBuilder, IDataModelClient } from "@kaleido-io/asset-manager-sdk";
import { IndexerContext, IndexerSnippetDef } from "./indexer.js";

function buildContext(am: IDataModelClient, name: string): IndexerContext {
    return {
        am,
        BulkUpsertBuilder,
        log: newLogger(name),
    };
}

/**
 * Wraps a plain { setup?, indexBatch } module export in the event processor pattern.
 * Called by MultiSnippetProvider after dynamic import() of each snippet file.
 */
export function createSnippetIndexer(name: string, def: IndexerSnippetDef) {
    return {
        async initialize(am: IDataModelClient): Promise<void> {
            if (def.setup) {
                await def.setup(buildContext(am, name));
            }
        },

        asEventProcessor(am: IDataModelClient): ReturnType<typeof createEventProcessor> {
            return createEventProcessor(name, async (_reqContext, events) => {
                return def.indexBatch(events, buildContext(am, name));
            });
        },
    };
}
