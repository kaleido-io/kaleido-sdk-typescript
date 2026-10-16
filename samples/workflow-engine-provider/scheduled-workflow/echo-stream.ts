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

import provider from '../provider.js';

/** Sends each scheduled event to the echo processor, which logs it. */
export const stream = {
  name: 'scheduled-echo',
  description: 'Pass each scheduled event to the echo event processor',
  started: true,
  eventSource: {
    type: 'handler',
    handler: {
      name: 'scheduled-source',
      provider: provider.name,
      config: { intervalMs: 10_000 },
    },
  },
  eventProcessor: {
    type: 'handler',
    handler: {
      name: 'echo',
      provider: provider.name,
    },
  },
};
