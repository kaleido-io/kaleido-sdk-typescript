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
 * Core types and builder for Flow definitions in the Workflow Engine
 */

export type JSONAny = any;

/** Represents the type of a flow stage */
export type FlowStageType = string;

/** Available flow stage types */
export const FlowStageTypes = {
  PENDING: 'pending' as FlowStageType,
  SUCCESS: 'success' as FlowStageType,
  FAILURE: 'failure' as FlowStageType,
} as const;

/** Represents the type of a flow operation */
export type FlowOperationType = string;

/** Available flow operation types */
export const FlowOperationTypes = {
  ASYNC: 'asynchronous' as FlowOperationType,
  SYNC: 'synchronous' as FlowOperationType,
} as const;

/** Input parameters for creating or updating a flow */
export interface FlowInput {
  name?: string;
  currentVersion?: string;
  description?: string;
  labels?: { [key: string]: string };
}

/** Embedded version information for a flow */
export interface FlowVersionEmbedded {
  version?: string;
  versionDescription?: string;
}

/** Complete flow resource including base fields */
export interface Flow extends FlowInput {
  id?: string;
  created?: string;
  updated?: string;
  // Embedded version fields (not nested)
  version?: string;
  versionDescription?: string;
  // Embedded flow definition fields (not nested)
  operations?: FlowOperation[];
  stages?: FlowStage[];
  events?: FlowEventHandler[];
  constants?: { [key: string]: JSONAny };
}

/** Handler binding target (provider and handler name). */
export interface HandlerBindingTarget {
  provider?: string;
  providerHandler?: string;
}

/** Flow input with inline version information. */
export interface FlowInputInlineVersion extends FlowVersionEmbedded, FlowInput, FlowDefinition {
  version?: string;
  versionDescription?: string;
  handlerBindings?: Record<string, HandlerBindingTarget>; // Maps handler names to binding targets
}

/** Definition of a flow's structure and behavior */
export interface FlowDefinition {
  operations?: FlowOperation[];
  stages?: FlowStage[];
  events?: FlowEventHandler[];
  constants?: { [key: string]: JSONAny };
}

/** Definition of a stage in the flow */
export interface FlowStage {
  name: string;
  type: FlowStageType;
  queueReduce?: FlowReducer;
  handler?: string;
  fullState?: boolean;
  inputMap?: FlowMapping;
  errorRetry?: FlowHandlerRetry;
  staleRetry?: FlowHandlerRetry;
}

/** Definition of an event handler in the flow */
export interface FlowEventHandler {
  name: string;
  topicMatch: string;
  handler: string;
  fullState?: boolean;
  inputMap?: FlowMapping;
  errorRetry?: FlowHandlerRetry;
}

/** Definition of an operation in the flow */
export interface FlowOperation {
  name: string;
  description?: string;
  type: FlowOperationType;
  sequenceMap?: FlowMapping;
  stage?: string;
  stateUpdates?: any;
  inputSchema?: JSONAny;
  outputSchema?: JSONAny;
  outputMap?: FlowMapping;
}

/** Configuration for reducing queue state */
export interface FlowReducer {
  initializer?: FlowMapping;
  reducer?: FlowMapping;
}

/** Configuration for flow transitions */
export interface FlowTransitions {
  onCondition: FlowConditionalTransition[];
  onFailure: FlowTransition;
}

/** Definition of a conditional transition */
export interface FlowConditionalTransition {
  condition?: FlowMapping;
  stage: string;
  data?: FlowMapping;
}

/** Definition of a transition */
export interface FlowTransition {
  stage: string;
  data?: FlowMapping;
}

/** Reference to a flow policy */
export interface FlowPolicyRef {
  name: string;
  version?: string;
  hash?: string;
}

/** Configuration for data mapping */
export interface FlowMapping {
  jsonata?: string;
  rego?: string;
}

/** Configuration for retry timing */
export interface FlowRetryTuning {
  initialDelay: string;
  maxDelay: string;
  factor: number;
}

/** Configuration for handler retry behavior */
export interface FlowHandlerRetry {
  disabled?: boolean;
  condition?: FlowMapping;
  tuning?: FlowRetryTuning;
}
