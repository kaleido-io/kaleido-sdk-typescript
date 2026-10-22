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

// ksdk run: run a TypeScript provider snippet package's handlers on this
// machine, connected to a workflow engine, the way a TypeScript provider runs them.

import { existsSync } from 'fs';
import { createRequire } from 'module';
import { join, resolve } from 'path';
import { runSnippetPackage } from '@kaleido-io/workflow-engine-sdk/snippet-package';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx ksdk run [--dir <project>] [--config <file>] [--kaleido-config <file>]

Runs a TypeScript provider snippet package's handlers on this machine, connected
to a workflow engine, exactly as a TypeScript provider runs them: the handlers
are found the way "ksdk package" finds them, each is bundled on its own, and its
imports are checked against the packages the provider supplies.

Each handler's ctx.config is its own config file, when the package.json
"kaleido.handlerConfig" names one, or the package's default config file.
Each handler sees only the secrets "kaleido.handlerSecrets" lists for it, read
from KALEIDO_SECRETS_DIR: one directory per secret, holding a file named value.

Options:
  --dir <project>          The project to run (default: the current directory)
  --config <file>          The default config file (default: CONFIG_FILE, then the
                           package.json "kaleido.config", then config/provider-config.yaml)
  --kaleido-config <file>  How to reach the workflow engine (default: KALEIDO_CONFIG_FILE,
                           then config/local.yaml). Keep this file out of git and out of
                           the package: it holds credentials.
`);
  process.exit(0);
}

const option = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
};

const projectDir = resolve(option('--dir') ?? process.cwd());
const configFile = option('--config') ? resolve(option('--config')) : undefined;

let kaleidoConfigFile = option('--kaleido-config') ? resolve(option('--kaleido-config')) : process.env.KALEIDO_CONFIG_FILE?.trim() || undefined;
if (!kaleidoConfigFile && existsSync(join(projectDir, 'config/local.yaml'))) {
  kaleidoConfigFile = join(projectDir, 'config/local.yaml');
}
if (!kaleidoConfigFile) {
  console.error(
    'Error: say how to reach the workflow engine, with KALEIDO_CONFIG_FILE, --kaleido-config, or a config/local.yaml in the project.',
  );
  process.exit(1);
}

// The project's own TypeScript reads the handlers properly; without it, a
// simpler reading of the source is used.
let typescript;
try {
  typescript = createRequire(join(projectDir, 'package.json'))('typescript');
} catch {
  typescript = undefined;
}

let client;
try {
  client = await runSnippetPackage(projectDir, { kaleidoConfigFile, configFile, typescript });
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const stop = () => {
  client.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
