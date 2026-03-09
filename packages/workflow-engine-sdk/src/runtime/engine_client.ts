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
  AsyncTransactionInput,
  IdempotentSubmitResult,
  WSMessageType,
  WSEngineAPISubmitTransactions,
  WSEngineAPISubmitTransactionsResult,
} from '../types/core';
import { EngineAPI } from '../interfaces/handlers';
import { newLogger } from '../log/logger';
import { SDKErrors, newError } from '../i18n/errors';

const log = newLogger('engine_client');

/**
 * Interface for the runtime that EngineClient depends on
 */
export interface EngineClientRuntime {
  sendMessage(message: any): void;
  getActiveHandlerContext(): { requestId: string; authTokens: Record<string, string> } | undefined;
  isWebSocketConnected(): boolean;
}

/**
 * Client for handlers to call back to the workflow engine.
 * Implements the EngineAPI interface and handles the round-trip
 * communication pattern for async operations like submitting transactions.
 */
export class EngineClient implements EngineAPI {
  private runtime: EngineClientRuntime;
  private inflightRequests: Map<string, { 
    resolve: (data: any) => void; 
    reject: (error: Error) => void;
  }> = new Map();

  constructor(runtime: EngineClientRuntime) {
    this.runtime = runtime;
  }

  /**
   * Submit async transactions to the workflow engine
   */
  async submitAsyncTransactions(
    authRef: string,
    transactions: AsyncTransactionInput[]
  ): Promise<IdempotentSubmitResult[]> {
    if (!this.runtime.isWebSocketConnected()) {
      throw newError(SDKErrors.MsgSDKEngineNotConnected);
    }

    const activeContext = this.runtime.getActiveHandlerContext();
    if (!activeContext) {
      throw newError(SDKErrors.MsgSDKEngineReqNoActiveRequest);
    }

    const requestId = this.generateId();
    log.debug('Submitting async transactions', { 
      requestId, 
      authRef, 
      count: transactions.length 
    });

    const request: WSEngineAPISubmitTransactions = {
      messageType: WSMessageType.ENGINE_API_SUBMIT_TRANSACTIONS,
      id: requestId,
      activeRequestId: activeContext.requestId,
      authRef: authRef,
      transactions: transactions,
    };

    return this.roundTrip<WSEngineAPISubmitTransactions, IdempotentSubmitResult[]>(
      request,
      requestId
    );
  }

  /**
   * Handle response for inflight request
   */
  handleResponse(message: WSEngineAPISubmitTransactionsResult): void {
    const inflight = this.inflightRequests.get(message.id);
    if (inflight) {
      this.inflightRequests.delete(message.id);
      if (message.error) {
        log.error('EngineAPI request failed', { 
          id: message.id, 
          error: message.error 
        });
        inflight.reject(new Error(message.error));
      } else {
        log.debug('EngineAPI request succeeded', { 
          id: message.id, 
          results: message.submissions?.length 
        });
        inflight.resolve(message.submissions || []);
      }
    } else {
      log.warn('Received response for unknown request', { id: message.id });
    }
  }

  /**
   * Round-trip request/response pattern
   */
  private roundTrip<REQ, RES>(request: REQ, requestId: string): Promise<RES> {
    return new Promise((resolve, reject) => {
      this.inflightRequests.set(requestId, { resolve, reject });
      this.runtime.sendMessage(request);
    });
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

