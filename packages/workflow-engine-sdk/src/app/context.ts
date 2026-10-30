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

import { createSetupContext, type SetupContext } from '@kaleido-io/core-sdk/context';
import type { ServiceClientOptions } from '@kaleido-io/core-sdk/http';
import type { RequestContext, WSEvaluateTransaction, WSEventStreamInfo } from '../types/core';
import { newError, SDKErrors } from '../i18n/errors';

/**
 * The secrets and files a handler was given where it is deployed.
 *
 * In a TypeScript provider they come from the handler's entry in the service
 * config. In your own provider they come from what you register the handler
 * with, and secrets default to the ones mounted under `KALEIDO_SECRETS_DIR`.
 *
 * A handler run by the SDK always has all three. They are optional in the type
 * so that a context built by hand, for example in a test, needn't list them:
 * the context types are public, and requiring them would break code that does.
 */
export interface HandlerSecretsAndFiles {
  /** The handler's secrets, by name. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The value of the handler's secret with this name. Throws for a name the handler has no secret for. */
  secret?(name: string): string;
  /** The handler's files from the service's file sets, mounted into the pod, by name, as paths. */
  readonly files?: Readonly<Record<string, string>>;
  /** The path of the handler's file with this name. Throws for a name the handler has no file for. */
  file?(name: string): string;
}

/** {@link HandlerSecretsAndFiles} as the SDK fills them in, with every member present. */
type FilledHandlerSecretsAndFiles = Required<HandlerSecretsAndFiles>;

const noEntries: Readonly<Record<string, string>> = Object.freeze({});

/** @internal — the secrets and files of the handler handling a request. */
export function createHandlerSecretsAndFiles(
  handlerName: string,
  provider?: { secrets?: Readonly<Record<string, string>>; files?: Readonly<Record<string, string>> },
): FilledHandlerSecretsAndFiles {
  const secrets = provider?.secrets ?? noEntries;
  const files = provider?.files ?? noEntries;
  return {
    secrets,
    files,
    secret(name: string): string {
      const value = Object.prototype.hasOwnProperty.call(secrets, name) ? secrets[name] : undefined;
      if (value === undefined) {
        // Names only: a secret's value never goes into an error.
        throw newError(SDKErrors.MsgSDKHandlerSecretUnknown, handlerName, name, Object.keys(secrets).join(', ') || '(none)');
      }
      return value;
    },
    file(name: string): string {
      const path = Object.prototype.hasOwnProperty.call(files, name) ? files[name] : undefined;
      if (path === undefined) {
        throw newError(SDKErrors.MsgSDKHandlerFileUnknown, handlerName, name, Object.keys(files).join(', ') || '(none)');
      }
      return path;
    },
  };
}

/**
 * Context injected into event processor `processBatch` callbacks.
 * Extends {@link SetupContext} with the request-scoped ID for the current batch.
 */
export interface EventProcessorContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerSecretsAndFiles {
  readonly requestId: string;
}

export function createEventProcessorContext<C>(
  setupCtx: SetupContext<C>,
  requestId: string,
  secretsAndFiles: HandlerSecretsAndFiles = createHandlerSecretsAndFiles(setupCtx.handlerName),
): EventProcessorContext<C> {
  return { ...setupCtx, ...secretsAndFiles, requestId };
}

/**
 * Context passed to a transaction handler action, one per transaction.
 *
 * `getServiceClientOptions` resolves bindings as the transaction's caller
 * (using its authRef), so hosted bindings work here without a setup hook.
 * `signal` aborts when the engine's deadline for the request passes.
 */
export interface TransactionContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerSecretsAndFiles {
  readonly requestId: string;
  readonly transaction: WSEvaluateTransaction;
}

/**
 * Context passed to an event source poll function, one per poll.
 *
 * `config` is the handler's config; the stream's own config is on the poll
 * function's first argument. Bindings resolve as the stream's owner (using the
 * poll's authRef).
 */
export interface EventSourceContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerSecretsAndFiles {
  readonly requestId: string;
  readonly stream: WSEventStreamInfo;
}

function bindingResolver(reqContext: RequestContext | undefined, authRef: string | undefined) {
  return (bindingName: string): ServiceClientOptions => {
    if (!reqContext?.provider) {
      throw newError(SDKErrors.MsgSDKServiceBindingsNeedClient, bindingName);
    }
    return reqContext.provider.getServiceClientOptions(bindingName, authRef);
  };
}

// A handler driven directly, without a request context, still gets a signal.
const neverAborted = new AbortController().signal;

/** @internal — used by evalDirected to build each transaction's context. */
export function createTransactionContext(
  reqContext: RequestContext | undefined,
  handlerName: string,
  transaction: WSEvaluateTransaction,
): TransactionContext {
  return {
    ...createSetupContext(
      bindingResolver(reqContext, transaction.authRef),
      reqContext?.provider?.config ?? {},
      reqContext?.provider?.providerName ?? '',
      handlerName,
      reqContext?.signal ?? neverAborted,
    ),
    ...createHandlerSecretsAndFiles(handlerName, reqContext?.provider),
    requestId: reqContext?.requestId ?? '',
    transaction,
  };
}

/** @internal — used by event sources to build each poll's context. */
export function createEventSourceContext(
  reqContext: RequestContext,
  handlerName: string,
  stream: WSEventStreamInfo,
  authRef: string | undefined,
): EventSourceContext {
  return {
    ...createSetupContext(
      bindingResolver(reqContext, authRef),
      reqContext.provider?.config ?? {},
      reqContext.provider?.providerName ?? '',
      handlerName,
      reqContext.signal,
    ),
    ...createHandlerSecretsAndFiles(handlerName, reqContext.provider),
    requestId: reqContext.requestId,
    stream: { streamId: stream.streamId, streamName: stream.streamName },
  };
}
