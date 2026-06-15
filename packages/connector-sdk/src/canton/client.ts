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

import { type SetupContext, ensureStream } from '@kaleido-io/workflow-engine-sdk';
import type { CantonContractEventsConfig } from './index.js';

/**
 * Client for the Kaleido Canton Connector. Provides helper methods for
 * setting up WFE streams backed by Canton contract event sources.
 */
export class CantonConnectorClient {
  private readonly bindingName: string;

  constructor(bindingName: string = 'canton-connector') {
    this.bindingName = bindingName;
  }

  /**
   * Idempotently create or update a Canton contract events stream on the connector.
   *
   * Delegates to {@link ensureStream} from `@kaleido-io/workflow-engine-sdk`.
   */
  async ensureStream(
    ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>,
    opts: {
      factory: string;
      name: string;
      eventSourceConfig: CantonContractEventsConfig;
      description?: string;
    },
  ): Promise<void> {
    await ensureStream(ctx, {
      connectorBindingName: this.bindingName,
      factory: opts.factory,
      name: opts.name,
      description: opts.description,
      eventSourceConfig: opts.eventSourceConfig,
    });
  }
}
