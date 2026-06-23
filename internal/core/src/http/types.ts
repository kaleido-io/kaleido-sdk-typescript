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
 * Minimal logging interface accepted by the HTTP transport's `logger` option.
 * Compatible with `console` and most logging libraries. Named distinctly from
 * the SDK's structured `Logger` (log/logger.ts) to avoid confusion — the two
 * have different method shapes (this one has `log`, that one has `info`).
 */
export interface HttpLogger {
  log: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

/**
 * Authentication configuration for a service binding.
 */
export interface ServiceBindingAuth {
  type: "basic" | "token";
  /** Basic auth username */
  username?: string;
  /** Basic auth password */
  password?: string;
  /** Token value */
  token?: string;
  /** Header name for token auth (default: Authorization) */
  header?: string;
  /** Token scheme prefix, e.g. "Bearer" (default: empty = raw token) */
  scheme?: string;
}
