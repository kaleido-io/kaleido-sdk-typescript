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

/** Error codes callers commonly branch on. */
export const ErrorCodes = {
  /** A unique key already exists (HTTP 409). */
  UniqueConflict: "KA240201",
  /** A parent reference does not resolve (HTTP 404). */
  ParentNotFound: "KA240202",
  /** The change conflicts with a reference between resources (HTTP 409). */
  ForeignKeyViolation: "KA240278",
  /** A bulk write names the same URN twice (HTTP 400). */
  DuplicateUrn: "KA240225",
} as const;

const CODE = /\bKA\d{6}\b/;

/**
 * The `KAxxxxxx` code of a failed subledger request, if any.
 *
 * Reads the `{ error: "KAxxxxxx: …" }` body of an HTTP error, falling back to
 * the error message.
 */
export function errorCode(err: unknown): string | undefined {
  const message = err instanceof Error ? err.message : undefined;
  for (const text of [responseError(err), message]) {
    const code = text?.match(CODE)?.[0];
    if (code) {
      return code;
    }
  }
  return undefined;
}

/** The error text of an HTTP error's response: the body itself, or its `error` field. */
function responseError(err: unknown): string | undefined {
  const body = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof body === "string") {
    return body;
  }
  const error = (body as { error?: unknown } | undefined)?.error;
  return typeof error === "string" ? error : undefined;
}
