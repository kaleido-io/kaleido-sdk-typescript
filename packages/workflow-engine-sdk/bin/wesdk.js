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


import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
  // Route to init script
  const initScript = join(__dirname, 'init.js');
  const child = spawn('node', [initScript, ...args.slice(1)], {
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
} else {
  console.log(`
@kaleido-io/workflow-engine-sdk CLI

Usage:
  npx @kaleido-io/workflow-engine-sdk <command> [options]

Commands:
  init <project-name>    Create a new provider project from template

Examples:
  npx @kaleido-io/workflow-engine-sdk init my-provider

For more information, run:
  npx @kaleido-io/workflow-engine-sdk init --help
`);
  process.exit(command ? 1 : 0);
}
