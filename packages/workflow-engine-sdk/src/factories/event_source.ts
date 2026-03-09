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
  EventSource,
  EngineAPI,
} from '../interfaces/handlers';
import {
  WSEventSourceConfig,
  WSListenerPollRequest,
  WSListenerPollResult,
  WSHandlerEnvelope,
  ListenerEvent,
  WSEventStreamInfo,
} from '../types/core';
import { newLogger } from '../log/logger';
import { getErrorMessage } from '../utils/errors';

const log = newLogger('event_source_factory');

/**
 * Configuration for an event source with parsed config.
 */
export interface EventSourceConf<CF> extends WSEventStreamInfo {
  config: CF;
}

/**
 * Event data structure returned by poll function.
 */
export interface EventSourceEvent<DT> {
  idempotencyKey: string;
  topic: string;
  data: DT;
}

/**
 * Poll function signature for event sources: (config, checkpointIn) => checkpointOut, events.
 */
export type EventSourcePollFn<CP, CF, DT> = (
  config: EventSourceConf<CF>,
  checkpointIn: CP | null
) => Promise<{ checkpointOut: CP; events: EventSourceEvent<DT>[] }>;

/**
 * Build initial checkpoint from configuration.
 */
export type EventSourceBuildInitialCheckpointFn<CP, CF> = (config: CF) => Promise<CP>;

/**
 * Delete function for cleanup when event source is removed.
 */
export type EventSourceDeleteFn = (info: WSEventStreamInfo) => Promise<void>;

/**
 * Custom config parser function.
 */
export type EventSourceConfigParserFn<CF> = (
  info: WSEventStreamInfo,
  config: any
) => Promise<CF>;

/**
 * Factory interface for building event sources with optional configuration.
 */
export interface EventSourceFactory<CP, CF, DT> extends EventSource {
  withDeleteFn(deleteFn: EventSourceDeleteFn): EventSourceFactory<CP, CF, DT>;
  withConfigParser(parserFn: EventSourceConfigParserFn<CF>): EventSourceFactory<CP, CF, DT>;
  withInitialCheckpoint(buildFn: EventSourceBuildInitialCheckpointFn<CP, CF>): EventSourceFactory<CP, CF, DT>;
  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): EventSourceFactory<CP, CF, DT>;
  withCloseFn(closeFn: () => void): EventSourceFactory<CP, CF, DT>;
}

/**
 * Internal event source implementation.
 */
class EventSourceBase<CP, CF, DT> implements EventSourceFactory<CP, CF, DT> {
  private _name: string;
  private pollFn: EventSourcePollFn<CP, CF, DT>;
  private deleteFn?: EventSourceDeleteFn;
  private configParserFn?: EventSourceConfigParserFn<CF>;
  private buildInitialCheckpointFn?: EventSourceBuildInitialCheckpointFn<CP, CF>;
  private initFn?: (engAPI: EngineAPI) => Promise<void>;
  private closeFn?: () => void;

  private confs: Map<string, EventSourceConf<CF>> = new Map();

  constructor(name: string, pollFn: EventSourcePollFn<CP, CF, DT>) {
    this._name = name;
    this.pollFn = pollFn;
  }

  name(): string {
    return this._name;
  }

  withDeleteFn(deleteFn: EventSourceDeleteFn): EventSourceFactory<CP, CF, DT> {
    this.deleteFn = deleteFn;
    return this;
  }

  withConfigParser(parserFn: EventSourceConfigParserFn<CF>): EventSourceFactory<CP, CF, DT> {
    this.configParserFn = parserFn;
    return this;
  }

  withInitialCheckpoint(buildFn: EventSourceBuildInitialCheckpointFn<CP, CF>): EventSourceFactory<CP, CF, DT> {
    this.buildInitialCheckpointFn = buildFn;
    return this;
  }

  withInitFn(initFn: (engAPI: EngineAPI) => Promise<void>): EventSourceFactory<CP, CF, DT> {
    this.initFn = initFn;
    return this;
  }

  withCloseFn(closeFn: () => void): EventSourceFactory<CP, CF, DT> {
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
    this.confs.clear();
  }

  /**
   * Build and parse config for a stream.
   */
  private async buildConf(
    info: WSEventStreamInfo,
    configData: any
  ): Promise<CF> {
    if (this.configParserFn) {
      return await this.configParserFn(info, configData);
    } else {
      // Simple JSON parsing (default)
      return configData as CF;
    }
  }

  /**
   * Build and cache config for a stream.
   */
  private async buildAndCacheConf(
    config: WSEventSourceConfig,
    request: WSListenerPollRequest
  ): Promise<EventSourceConf<CF>> {
    const info: WSEventStreamInfo = {
      streamId: request.streamId,
      streamName: request.streamName,
    };
    const parsedConfig = await this.buildConf(info, config.config);

    const esConf: EventSourceConf<CF> = {
      ...info,
      config: parsedConfig,
    };

    this.confs.set(request.streamId, esConf);
    return esConf;
  }

  /**
   * Validate config and optionally set initial checkpoint.
   */
  async eventSourceValidateConfig(result: any, request: any): Promise<void> {
    try {
      const parsedConfig = await this.buildConf(
        {
          streamId: request.streamId,
          streamName: request.streamName,
        },
        request.config
      );

      if (this.buildInitialCheckpointFn) {
        const initialCheckpoint = await this.buildInitialCheckpointFn(parsedConfig);
        result.initialCheckpoint = initialCheckpoint;
      }
    } catch (error) {
      log.error('Failed to validate config', { error });
      result.error = getErrorMessage(error);
    }
  }

  /**
   * Poll for events.
   * Mutates the `result` parameter to match the engine's output-by-reference API.
   */
  async eventSourcePoll(
    config: WSEventSourceConfig,
    result: WSListenerPollResult,
    request: WSListenerPollRequest
  ): Promise<void> {
    try {
      // Get or build cached config
      let esConf = this.confs.get(request.streamId);
      if (!esConf) {
        esConf = await this.buildAndCacheConf(config, request);
      }

      // Get checkpoint from request, normalize undefined to null for poll function
      const checkpointIn: CP | null = request.checkpoint ?? null;

      // Call user's poll function
      const pollResult = await this.pollFn(esConf, checkpointIn);

      // Map events to ListenerEvent format
      result.events = pollResult.events.map((evt): ListenerEvent => ({
        idempotencyKey: evt.idempotencyKey,
        topic: evt.topic,
        data: evt.data,
      }));

      // Set checkpoint
      result.checkpoint = pollResult.checkpointOut;
    } catch (error) {
      log.error('Poll failed', { error });
      result.error = getErrorMessage(error);
    }
  }

  /**
   * Delete event source and clear cached config.
   */
  async eventSourceDelete(result: WSHandlerEnvelope, request: any): Promise<void> {
    try {
      if (this.deleteFn) {
        await this.deleteFn({
          streamId: request.streamId,
          streamName: request.streamName,
        });
      }

      this.confs.delete(request.streamId);
    } catch (error) {
      log.error('Delete failed', { error });
      result.error = getErrorMessage(error);
    }
  }
}

/**
 * Create a new event source with a poll function.
 *
 * @param name - Handler name to register with the workflow engine
 * @param pollFn - Function that polls for new events
 * @returns EventSourceFactory for chaining configuration
 */
export function newEventSource<CP, CF, DT>(
  name: string,
  pollFn: EventSourcePollFn<CP, CF, DT>
): EventSourceFactory<CP, CF, DT> {
  return new EventSourceBase<CP, CF, DT>(name, pollFn);
}
