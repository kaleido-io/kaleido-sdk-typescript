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
 * Building, checking and unpacking TypeScript provider snippet packages,
 * imported from `@kaleido-io/workflow-engine-sdk/snippet-package`. Node only.
 */

export {
  MAX_PACKAGE_ENTRIES,
  MAX_PACKAGE_UNCOMPRESSED_BYTES,
  MAX_PACKAGE_JSON_BYTES,
  SUPPORTED_DEPENDENCY_SCOPE,
  HANDLER_KINDS,
  SnippetPackageError,
  normalizeSnippetPackage,
  checkSnippetPackage,
  inspectSnippetPackage,
  extractSnippetPackage,
  packSnippetPackage,
} from './package';
export type {
  HandlerKind,
  SnippetPackageHandler,
  SnippetPackageManifest,
  SnippetPackageJson,
  SnippetPackageFile,
  NormalizedSnippetPackage,
  SnippetPackageCheck,
} from './package';
export { readZip, writeZip, ZipFormatError } from './zip';
export type { ZipEntry, ZipInput } from './zip';
