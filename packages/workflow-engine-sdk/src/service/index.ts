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

// Re-export all shared transport infrastructure from @kaleido-io/service-client.
// Public API of workflow-engine-sdk is unchanged.
export {
  ServiceTransport,
  HTTPTransport,
  HTTPTransportOptions,
  WSProxyTransport,
  WSProxyTransportOptions,
  WSProxyServiceClient,
  IWSProxy,
  WSProxyResponse,
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
  ServiceBindingAuth,
  configureHttpClient,
  HttpClientOptions,
  RetryConfig,
  RequestConfigWithRetry,
} from "@kaleido-io/core/http";

// WFE-specific binding configuration types (hosted vs non-hosted)
export {
  ServiceBindingConfig,
  NonHostedServiceBindingConfig,
  HostedServiceBindingConfig,
  ServiceBindingsMap,
} from "./types";

// WFE-specific WS proxy adapter (implements IWSProxy for the WFE protocol)
export { WSProxyAdapter, ProxyAdapterRuntime } from "./ws_proxy_adapter";

// WFE protocol message types
export { ServiceProxyRequest, ServiceProxyResponse } from "../types/core";
