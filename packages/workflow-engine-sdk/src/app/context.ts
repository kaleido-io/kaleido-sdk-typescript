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
 * The secrets and resources a handler was given where it is deployed.
 *
 * In a TypeScript provider they come from the handler's entry in the service
 * config. In your own provider they come from what you register the handler
 * with, and secrets default to the ones mounted under `KALEIDO_SECRETS_DIR`.
 *
 * A handler run by the SDK always has all three. They are optional in the type
 * so that a context built by hand, for example in a test, needn't list them:
 * the context types are public, and requiring them would break code that does.
 */
export interface HandlerResources {
  /** The handler's secrets, by name. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The handler's resources: files from the service's file sets, mounted into the pod, by name, as paths. */
  readonly resources?: Readonly<Record<string, string>>;
  /** The path of the handler's resource with this name. Throws for a name the handler has no resource for. */
  resource?(name: string): string;
}

/** {@link HandlerResources} as the SDK fills them in, with every member present. */
type FilledHandlerResources = Required<HandlerResources>;

const noEntries: Readonly<Record<string, string>> = Object.freeze({});

/** @internal — the secrets and resources of the handler handling a request. */
export function createHandlerResources(
  handlerName: string,
  provider?: { secrets?: Readonly<Record<string, string>>; resources?: Readonly<Record<string, string>> },
): FilledHandlerResources {
  const secrets = provider?.secrets ?? noEntries;
  const resources = provider?.resources ?? noEntries;
  return {
    secrets,
    resources,
    resource(name: string): string {
      const path = Object.prototype.hasOwnProperty.call(resources, name) ? resources[name] : undefined;
      if (path === undefined) {
        throw newError(SDKErrors.MsgSDKHandlerResourceUnknown, handlerName, name, Object.keys(resources).join(', ') || '(none)');
      }
      return path;
    },
  };
}

/**
 * Context injected into event processor `processBatch` callbacks.
 * Extends {@link SetupContext} with the request-scoped ID for the current batch.
 */
export interface EventProcessorContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerResources {
  readonly requestId: string;
}

export function createEventProcessorContext<C>(
  setupCtx: SetupContext<C>,
  requestId: string,
  resources: HandlerResources = createHandlerResources(setupCtx.handlerName),
): EventProcessorContext<C> {
  return { ...setupCtx, ...resources, requestId };
}

/**
 * Context passed to a transaction handler action, one per transaction.
 *
 * `getServiceClientOptions` resolves bindings as the transaction's caller
 * (using its authRef), so hosted bindings work here without a setup hook.
 * `signal` aborts when the engine's deadline for the request passes.
 */
export interface TransactionContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerResources {
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
export interface EventSourceContext<CustomConfig = unknown> extends SetupContext<CustomConfig>, HandlerResources {
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
    ...createHandlerResources(handlerName, reqContext?.provider),
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
    ...createHandlerResources(handlerName, reqContext.provider),
    requestId: reqContext.requestId,
    stream: { streamId: stream.streamId, streamName: stream.streamName },
  };
}
