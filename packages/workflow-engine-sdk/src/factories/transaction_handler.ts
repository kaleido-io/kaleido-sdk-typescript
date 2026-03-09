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


/**
 * Transaction Handler Factory
 * 
 * Provides factory functions for creating transaction handlers,
 * especially directed transaction handlers using the StageDirector pattern.
 */

import {
  WithStageDirector,
  WSHandleTransactions,
  WSHandleTransactionsResult,
} from '../types/core';
import {
  TransactionHandler,
  DirectedActionConfig,
  EngineAPI,
} from '../interfaces/handlers';
import { evalDirected } from '../helpers/stage_director';

/**
 * Transaction handler factory interface.
 */
export interface TransactionHandlerFactory extends TransactionHandler {
  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): TransactionHandlerFactory;
  withCloseFn(closeFn: () => void): TransactionHandlerFactory;
}

/**
 * Internal base implementation for directed transaction handlers.
 */
class TransactionHandlerBase<T extends WithStageDirector> implements TransactionHandlerFactory {
  private _name: string;
  private actionMap: Map<string, DirectedActionConfig<T>>;
  private initFn?: (engAPI: EngineAPI) => Promise<void>;
  private closeFn?: () => void;

  constructor(name: string, actionMap: Map<string, DirectedActionConfig<T>>) {
    this._name = name;
    this.actionMap = actionMap;
  }

  name(): string {
    return this._name;
  }

  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): TransactionHandlerFactory {
    this.initFn = initFn;
    return this;
  }

  withCloseFn(closeFn: () => void): TransactionHandlerFactory {
    this.closeFn = closeFn;
    return this;
  }

  async init(engAPI: EngineAPI): Promise<void> {
    if (this.initFn) {
      await this.initFn(engAPI);
    }
  }

  close(): void {
    if (this.closeFn) {
      this.closeFn();
    }
  }

  async transactionHandlerBatch(
    reply: WSHandleTransactionsResult,
    batch: WSHandleTransactions
  ): Promise<void> {
    await evalDirected(reply, batch, this.actionMap);
  }
}

/**
 * Create a new simple directed handler, with no initialization.
 *
 * A directed handler uses the StageDirector pattern to route transactions
 * to different actions based on the input's `action` field.
 * 
 * @param name Handler name
 * @param actionMap Map of action names to their configurations
 * @returns A TransactionHandlerFactory for chaining
 */
export function newDirectedTransactionHandler<T extends WithStageDirector>(
  name: string,
  actionMap: Map<string, DirectedActionConfig<T>>
): TransactionHandlerFactory {
  return new TransactionHandlerBase<T>(name, actionMap);
}
