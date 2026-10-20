#!/usr/bin/env node
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

// ksdk package: zip a TypeScript provider snippet package and check it against
// the rules the platform applies.

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { inspectSnippetPackage, packSnippetPackage } from '@kaleido-io/workflow-engine-sdk/snippet-package';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx ksdk package [--out <file>] [--dir <project>]

Zips a TypeScript provider snippet package, leaving out node_modules, build
output, lockfiles and anything .gitignore names, then checks it: a package.json at the
root, dependencies only on @kaleido-io/* packages, and every handler in the
package.json "kaleido" section present.

Options:
  --out <file>    Where to write the zip (default: <name>-<version>.zip)
  --dir <project> The project to package (default: the current directory)
`);
  process.exit(0);
}

const option = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
};

const projectDir = resolve(option('--dir') ?? process.cwd());
let pkg;
try {
  pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
} catch {
  console.error(`Error: no readable package.json in ${projectDir}`);
  process.exit(1);
}

const baseName = String(pkg.name ?? 'snippet-package').replace(/^@[^/]+\//, '');
const out = resolve(option('--out') ?? `${baseName}-${pkg.version ?? '0.0.0'}.zip`);

const { zip, files } = packSnippetPackage(projectDir);
const { problems, packageJson } = inspectSnippetPackage(zip);
if (problems.length > 0) {
  console.error('The package is not valid:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

writeFileSync(out, zip);
const handlers = ['transactionHandlers', 'eventSources', 'eventProcessors']
  .flatMap((kind) => (packageJson?.kaleido?.[kind] ?? []).map((h) => `${h.name} (${kind})`));
console.log(`Wrote ${out}: ${files.length} files, ${zip.length} bytes.`);
console.log(handlers.length > 0 ? `Handlers: ${handlers.join(', ')}` : 'No handlers listed in the package.json "kaleido" section.');
