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

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

const GITHUB_REPO = 'https://github.com/kaleido-io/kaleido-sdk-typescript.git';
const AVAILABLE_TEMPLATES = ['getting-started', 'erc20-indexer', 'btc-indexer'];

const projectNameRegex = /^(?:@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*)$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the SDK version from our own package.json so we can pin it in generated projects
const PROJECT_ROOT = resolve(__dirname, '..');
const sdkPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const SDK_VERSION = `^${sdkPkg.version}`;

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: npx @kaleido-io/workflow-engine-sdk init <project-name> [options]

Options:
  --help, -h       Show this help message

Examples:
  npx @kaleido-io/workflow-engine-sdk init my-provider --template getting-started
  npx @kaleido-io/workflow-engine-sdk init my-provider --template erc20-indexer
  npx @kaleido-io/workflow-engine-sdk init @my-scope/my-provider --template getting-started
  npx @kaleido-io/workflow-engine-sdk init @my-scope/my-provider --template erc20-indexer
`);
  process.exit(0);
}

const projectName = args[0];

if (!projectNameRegex.test(projectName)) {
  console.error(`Error: Project name "${projectName}" is invalid.`);
  console.error('Project names must contain only lowercase letters, numbers, and hyphens, and optionally a scope prefix.');
  process.exit(1);
}

const templateIdx = args.indexOf('--template');
if (templateIdx === -1 || templateIdx + 1 >= args.length) {
  console.error('Error: --template <name> is required.');
  console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(', ')}`);
  process.exit(1);
}
const templateName = args[templateIdx + 1];

if (!AVAILABLE_TEMPLATES.includes(templateName)) {
  console.error(`Error: Unknown template "${templateName}".`);
  console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(', ')}`);
  process.exit(1);
}

const cwd = process.cwd();
const targetDir = join(cwd, projectName);

if (existsSync(targetDir)) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  console.error('Please choose a different name or remove the existing directory.');
  process.exit(1);
}

// Check git is available
const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore' });
if (gitCheck.status !== 0) {
  console.error('Error: git is required to fetch templates but was not found on PATH.');
  process.exit(1);
}

console.log(`\nCreating new provider project: ${projectName} (from template: ${templateName})`);
console.log(`Location: ${targetDir}\n`);

// Fetch the template from GitHub using sparse checkout so we only download what we need
const tmpDir = mkdtempSync(join(tmpdir(), 'wesdk-'));
try {
  console.log('Fetching template from GitHub...');

  const clone = spawnSync(
    'git',
    ['clone', '--depth=1', '--filter=blob:none', '--sparse', '--quiet', GITHUB_REPO, tmpDir],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (clone.status !== 0) {
    throw new Error(`git clone failed: ${clone.stderr?.toString().trim()}`);
  }

  const sparse = spawnSync(
    'git',
    ['sparse-checkout', 'set', `samples/${templateName}`],
    { cwd: tmpDir, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (sparse.status !== 0) {
    throw new Error(`git sparse-checkout failed: ${sparse.stderr?.toString().trim()}`);
  }

  const sourceDir = join(tmpDir, 'samples', templateName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Template "${templateName}" was not found in the repository.`);
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
} catch (err) {
  rmSync(tmpDir, { recursive: true, force: true });
  console.error(`Error fetching template: ${err.message}`);
  process.exit(1);
}
rmSync(tmpDir, { recursive: true, force: true });

// Walk the copied project and apply variable substitutions
const variables = { PROVIDER_NAME: projectName };

function applyVariables(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      applyVariables(fullPath);
    } else if (entry.isFile()) {
      try {
        let content = readFileSync(fullPath, 'utf-8');
        for (const [key, value] of Object.entries(variables)) {
          content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        writeFileSync(fullPath, content, 'utf-8');
      } catch {
        // skip binary or unreadable files
      }
    }
  }
}

applyVariables(targetDir);

// Fix package.json: set the project name and pin @kaleido-io/* versions
const pkgPath = join(targetDir, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.name = projectName;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (pkg[section]) {
      for (const dep of Object.keys(pkg[section])) {
        if (dep.startsWith('@kaleido-io/') && pkg[section][dep] === '*') {
          pkg[section][dep] = SDK_VERSION;
        }
      }
    }
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

console.log(`Project ${projectName} initialized\n`);
console.log('Next steps:');
console.log(`\tcd ${projectName}`);
console.log('\tnpm install');
console.log('\t# Edit config/wfe-config.yaml with your configuration');
console.log('\tnpm run start:dev\n');
