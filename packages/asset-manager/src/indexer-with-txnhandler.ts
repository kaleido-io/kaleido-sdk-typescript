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

import { createDirectedTransactionHandler, DirectedActionConfig, RequestContext, TransactionHandler, WithStageDirector, WorkflowEngineClient, WSHandleTransactions, WSHandleTransactionsResult } from "@kaleido-io/workflow-engine-sdk";
import { Indexer, IndexerConfig } from "./indexer";

export abstract class IndexerWithTxnHandler<CustomConfig, EventDataType> extends Indexer<CustomConfig, EventDataType> {

    private readonly txnHandler: TransactionHandler;

    constructor(
        indexerHandlerName: string,
        private readonly txnHandlerName: string,
        actionMap: Record<string, DirectedActionConfig<WithStageDirector>>,
        esConfig: IndexerConfig<CustomConfig>) {
        super(indexerHandlerName, esConfig);
        this.txnHandler = createDirectedTransactionHandler(txnHandlerName, actionMap)
    }

    override async setupWorkflowEngine(wfeClient: WorkflowEngineClient): Promise<void> {
        super.setupWorkflowEngine(wfeClient);
        // Register our additional handler
        wfeClient.registerTransactionHandler(this.txnHandlerName, this.txnHandler);
    }

    async transactionHandlerBatch(
        reqContext: RequestContext,
        result: WSHandleTransactionsResult,
        batch: WSHandleTransactions
    ): Promise<void> {
        return this.txnHandler.transactionHandlerBatch(reqContext, result, batch);
    }


}
