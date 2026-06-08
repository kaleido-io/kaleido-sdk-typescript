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
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

const GITHUB_REPO = process.env.WESDK_REPO_URL ?? 'https://github.com/kaleido-io/kaleido-sdk-typescript.git';
const AVAILABLE_TEMPLATES = ['getting-started', 'erc20-indexer', 'btc-indexer', 'native-eth-indexer'];
const projectNameRegex = /^(?:@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*)$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, '..');
const sdkPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const FALLBACK_VERSION = `^${sdkPkg.version}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectFiles(dir, base, result = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath, base, result);
    else result.push(relative(base, fullPath));
  }
  return result;
}

function applyVariables(dir, variables) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      applyVariables(fullPath, variables);
    } else {
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

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: npx @kaleido-io/sdk init [project-name] [options]

  project-name        Name of the new project directory to create.
                      Omit to add a template into the current project.

Options:
  --template <name>   Template to scaffold (${AVAILABLE_TEMPLATES.join(', ')})
  --help, -h          Show this help message

Examples:
  npx @kaleido-io/sdk init my-provider --template getting-started
  npx @kaleido-io/sdk init @my-org/my-provider --template erc20-indexer
  npx @kaleido-io/sdk init --template erc20-indexer    # add to current project
`);
  process.exit(0);
}

// project-name is the first positional arg — absent when first arg is a flag
const hasProjectName = args[0] && !args[0].startsWith('--');
const projectName = hasProjectName ? args[0] : null;

if (projectName && !projectNameRegex.test(projectName)) {
  console.error(`Error: Project name "${projectName}" is invalid.`);
  console.error('Names must be lowercase letters, numbers, and hyphens (with optional @scope/ prefix).');
  process.exit(1);
}

// ── Template selection (interactive when --template is omitted) ───────────────

const templateIdx = args.indexOf('--template');
let templateName = (templateIdx !== -1 && templateIdx + 1 < args.length) ? args[templateIdx + 1] : null;

if (!templateName) {
  if (!process.stdin.isTTY) {
    console.error('Error: --template <name> is required in non-interactive mode.');
    console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(', ')}`);
    process.exit(1);
  }
  const { createInterface } = await import('readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    templateName = (await rl.question(`Select a template [${AVAILABLE_TEMPLATES.join(' | ')}]: `)).trim();
  } finally {
    rl.close();
  }
}

if (!AVAILABLE_TEMPLATES.includes(templateName)) {
  console.error(`Error: Unknown template "${templateName}".`);
  console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(', ')}`);
  process.exit(1);
}

// ── Mode detection ────────────────────────────────────────────────────────────

const cwd = process.cwd();
const cwdPkgPath = join(cwd, 'package.json');
const addToExisting = !projectName && existsSync(cwdPkgPath);
const targetDir = projectName ? join(cwd, projectName) : cwd;

if (!projectName && !addToExisting) {
  console.error('Error: No project name given and no package.json found in the current directory.');
  console.error('Either provide a project name to create a new project, or run inside an existing one.');
  process.exit(1);
}

if (projectName && existsSync(targetDir)) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  console.error('Choose a different name or remove the existing directory.');
  process.exit(1);
}

// ── Git check ─────────────────────────────────────────────────────────────────

const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore' });
if (gitCheck.status !== 0) {
  console.error('Error: git is required to fetch templates but was not found on PATH.');
  process.exit(1);
}

if (addToExisting) {
  console.log(`\nAdding "${templateName}" template to existing project at ${cwd}\n`);
} else {
  console.log(`\nCreating new project: ${projectName} (template: ${templateName})`);
  console.log(`Location: ${targetDir}\n`);
}

// ── Fetch template ────────────────────────────────────────────────────────────

// Files that are monorepo-specific and must never appear in a standalone project
const SKIP_FILES = new Set(['Dockerfile.withsdk', 'package-lock.json']);

// In add-to-existing mode only these subdirectories are merged in
const ADD_COPY_DIRS = ['src', 'config'];

const versionMap = {};
let templateKaleidoDeps = {};  // @kaleido-io/* deps declared in the template's package.json
const copiedFiles = [];        // populated in add-to-existing mode for the summary

const tmpDir = mkdtempSync(join(tmpdir(), 'ksdk-'));
try {
  console.log('Fetching template...');

  const clone = spawnSync(
    'git',
    ['clone', '--depth=1', '--filter=blob:none', '--sparse', '--quiet', GITHUB_REPO, tmpDir],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr?.toString().trim()}`);

  const sparse = spawnSync(
    'git',
    ['sparse-checkout', 'set', `samples/${templateName}`],
    { cwd: tmpDir, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (sparse.status !== 0) throw new Error(`git sparse-checkout failed: ${sparse.stderr?.toString().trim()}`);

  // Build a per-package version map by reading manifests directly from git objects.
  // git show fetches the blob lazily for remote partial clones and works with local paths too.
  for (const manifestPath of [
    'packages/sdk/package.json',
    'packages/workflow-engine-sdk/package.json',
    'packages/asset-manager/package.json',
  ]) {
    const result = spawnSync('git', ['show', `HEAD:${manifestPath}`], {
      cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0) {
      const { name, version } = JSON.parse(result.stdout);
      if (name && version) versionMap[name] = `^${version}`;
    }
  }

  const sourceDir = join(tmpDir, 'samples', templateName);
  if (!existsSync(sourceDir)) throw new Error(`Template "${templateName}" not found in repository.`);

  // Read the template's @kaleido-io/* deps before cleanup so we can merge them in add-to-existing mode
  const templatePkgPath = join(sourceDir, 'package.json');
  if (existsSync(templatePkgPath)) {
    const tpkg = JSON.parse(readFileSync(templatePkgPath, 'utf-8'));
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const dep of Object.keys(tpkg[section] ?? {})) {
        if (dep.startsWith('@kaleido-io/')) templateKaleidoDeps[dep] = tpkg[section][dep];
      }
    }
  }

  if (addToExisting) {
    for (const dir of ADD_COPY_DIRS) {
      const srcPath = join(sourceDir, dir);
      if (existsSync(srcPath)) {
        const destPath = join(targetDir, dir);
        cpSync(srcPath, destPath, { recursive: true });
        collectFiles(destPath, targetDir, copiedFiles);
      }
    }
  } else {
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourceDir, targetDir, {
      recursive: true,
      filter: (src) => !SKIP_FILES.has(src.split('/').pop()),
    });
  }
} catch (err) {
  rmSync(tmpDir, { recursive: true, force: true });
  console.error(`\nError fetching template: ${err.message}`);
  process.exit(1);
}
rmSync(tmpDir, { recursive: true, force: true });

// ── Variable substitution ─────────────────────────────────────────────────────

const existingPkgName = addToExisting ? JSON.parse(readFileSync(cwdPkgPath, 'utf-8')).name : null;
const variables = { PROVIDER_NAME: projectName ?? existingPkgName ?? 'my-project' };

if (addToExisting) {
  for (const dir of ADD_COPY_DIRS.map(d => join(targetDir, d))) {
    if (existsSync(dir)) applyVariables(dir, variables);
  }
} else {
  applyVariables(targetDir, variables);
}

// ── package.json update ───────────────────────────────────────────────────────

const pkgPath = addToExisting ? cwdPkgPath : join(targetDir, 'package.json');
const addedDeps = {};

if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  if (addToExisting) {
    // Merge missing @kaleido-io/* deps from the template into the existing project
    pkg.dependencies ??= {};
    for (const dep of Object.keys(templateKaleidoDeps)) {
      if (!pkg.dependencies[dep] && !pkg.devDependencies?.[dep]) {
        const version = versionMap[dep] ?? FALLBACK_VERSION;
        pkg.dependencies[dep] = version;
        addedDeps[dep] = version;
      }
    }
  } else {
    // New project: set name and pin all @kaleido-io/* wildcards
    pkg.name = projectName;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const dep of Object.keys(pkg[section] ?? {})) {
        if (dep.startsWith('@kaleido-io/') && pkg[section][dep] === '*') {
          pkg[section][dep] = versionMap[dep] ?? FALLBACK_VERSION;
        }
      }
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (addToExisting) {
  console.log(`Template "${templateName}" added.\n`);
  if (copiedFiles.length > 0) {
    console.log('Files copied:');
    for (const f of copiedFiles) console.log(`\t${f}`);
  }
  if (Object.keys(addedDeps).length > 0) {
    console.log('\nDependencies added to package.json:');
    for (const [dep, ver] of Object.entries(addedDeps)) console.log(`\t${dep}: ${ver}`);
    console.log('\nNext steps:');
    console.log('\tnpm install');
  } else {
    console.log('\nAll @kaleido-io/* dependencies already present — no package.json changes needed.');
  }
  console.log('');
} else {
  console.log(`Project ${projectName} initialized\n`);
  console.log('Next steps:');
  console.log(`\tcd ${projectName}`);
  console.log('\tnpm install');
  console.log('\t# Edit config files with your configuration');
  console.log('\tnpm run start:dev\n');
}
