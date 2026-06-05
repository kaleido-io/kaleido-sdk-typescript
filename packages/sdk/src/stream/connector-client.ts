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

import { ServiceClient, ServiceClientOptions, createServiceTransport } from '@kaleido-io/workflow-engine-sdk';

/**
 * Minimal concrete HTTP/WS-proxy client used by ensureStream to call connector REST APIs.
 * Not part of the public SDK surface — instantiated internally by ensureStream.
 */
export class ConnectorClient extends ServiceClient {
  constructor(options: ServiceClientOptions) {
    super(createServiceTransport(options));
  }

  putStream<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.put<T>(path, body);
  }
}
