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

import type { KldResourceBase } from './common.js';

export type SubscriptionType = "webhook" | "websocket";

export type DistributionMode = "broadcast" | "load_balance";

export interface WebhookConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  tlsConfig?: {
    insecure?: boolean;
    clientCertificate?: string;
    clientKey?: string;
    caCertificate?: string;
  };
}

export interface WebSocketConfig {
  distributionMode?: DistributionMode;
}

export interface EventStreamSpecFields {
  name?: string;
  topicFilter?: string;
  batchSize?: number;
  batchTimeout?: number;
  blockedRetryDelay?: number;
  initialSequenceID?: string;
}

export interface DataModelSubscriptionInput extends EventStreamSpecFields {
  type?: SubscriptionType;
  webhook?: WebhookConfig;
  websocket?: WebSocketConfig;
}

export interface DataModelSubscription
  extends KldResourceBase, DataModelSubscriptionInput {
  status?: string;
  statistics?: {
    eventsReceived?: number;
    eventsProcessed?: number;
    eventsDelivered?: number;
    eventsDelayed?: number;
  };
}

export interface SubscriptionResetRequest {
  sequenceId?: string;
}

export interface DataModelListenerInput extends EventStreamSpecFields {
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
}

export interface DataModelListener
  extends KldResourceBase, DataModelListenerInput {
  identity?: string;
  identityContext?: any;
  replayCount?: number;
  status?: string;
  statistics?: {
    eventsReceived?: number;
    eventsProcessed?: number;
    eventsDelivered?: number;
    eventsDelayed?: number;
  };
}

export interface DataModelListenerResetRequest {
  sequenceId?: string;
  replay?: boolean;
}

export interface FireFlyListenerConfig {
  namespace?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  eventTypes?: string[];
  blockchainEvents?: {
    locations?: any[];
    abiEvents?: any;
    createOptions?: any;
  };
}

export interface FireFlyListenerInput {
  name?: string;
  disabled?: boolean;
  config?: FireFlyListenerConfig;
}

export interface FireFlyListener extends KldResourceBase, FireFlyListenerInput {
  identity?: string;
}
