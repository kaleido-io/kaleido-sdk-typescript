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
// Transport interface
export { ServiceTransport } from "./transport";

// Transport implementations
export { HTTPTransport, HTTPTransportOptions } from "./http_base";
export {
  WSProxyTransport,
  WSProxyTransportOptions,
  WSProxyServiceClient,
  IWSProxy,
  WSProxyResponse,
} from "./ws_proxy_transport";

// ServiceClient base class + factory
export {
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
} from "./service_client";

// Auth types
export { ServiceBindingAuth } from "./types";

// HTTP client configuration
export {
  configureHttpClient,
  HttpClientOptions,
  RetryConfig,
  RequestConfigWithRetry,
} from "./http_client";
