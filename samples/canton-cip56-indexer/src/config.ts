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

import type { CantonContractEventsConfig } from '@kaleido-io/connector-sdk/canton';

// Provider config (CONFIG_FILE). Platform connections (WFE URL, auth, the
// canton-connector and subledger service bindings) live in config.yaml.
export interface CantonConfig {
  subledger?: {
    /** Service binding of the Token Subledger (default `subledger`). */
    bindingName?: string;
    /** The blockchain Chain the ledger is written under (default `canton`). */
    chain?: string;
    /** The `source` written on each chain transaction (default `canton-cip56-indexer`). */
    source?: string;
  };
  stream?: {
    connectorBindingName: string;
    factory: string;
    name: string;
    description?: string;
    eventSourceConfig: CantonContractEventsConfig;
  };
}
