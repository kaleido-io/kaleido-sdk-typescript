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

// The service-binding vocabulary is owned by @kaleido-io/core (alongside
// ServiceClientOptions / ServiceBindingAuth / the binding resolvers). These are
// re-exported here so the workflow-engine-sdk public API is unchanged for
// existing importers of `../service/types`.
export { ServiceBindingAuth } from "@kaleido-io/core/http";
export {
  ServiceBindingConfig,
  NonHostedServiceBindingConfig,
  HostedServiceBindingConfig,
  ServiceBindingsMap,
} from "@kaleido-io/core";
