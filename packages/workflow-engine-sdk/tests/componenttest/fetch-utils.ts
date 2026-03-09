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

import { newLogger } from "../../src/log/logger";

const logger = newLogger('FetchWithRetry');
/**
 * A fetch wrapper that retries on 429 status codes, to enable tests to run more
 * robustly aganst extra small workflow engine runtimes
 */
export const fetchWithRetry = async (url: string, options: RequestInit): Promise<Response> => {
  let attempts = 0;
  while (attempts < 5) {
    // inject a small amount of latency to reduce 429s
    await new Promise(resolve => setTimeout(resolve, 10));
    const response = await fetch(url, options);
    if (!response.ok && response.status === 429) {
      attempts++;
      logger.warn(`Rate limited, retrying... ${attempts}/5`);
      // inject a larger amount of latency now
      await new Promise(resolve => setTimeout(resolve, attempts * 200));
      continue;
    } else {
      return response;
    }
  }
  throw new Error('Failed to fetch with retry');
};