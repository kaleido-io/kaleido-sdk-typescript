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


import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectNameRegex = /^(?:@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*)$/;

const templateConfig = {
  'variables': {
    'PROVIDER_NAME': {
      'description': 'The npm package name for the provider',
      'default': 'my-provider',
      'required': true
    }
  },
  'files': {
    'package.json': {
      'replace': [
        'PROVIDER_NAME'
      ]
    },
    'src/provider.ts': {
      'replace': [
        'PROVIDER_NAME',
      ]
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root (parent of bin directory)
// When installed via npm, this will be in node_modules/@kaleido-io/workflow-engine-sdk
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATE_DIR = join(PROJECT_ROOT, 'template');
const SAMPLES_DIR = join(PROJECT_ROOT, 'samples');

// Files and directories to exclude when copying template
const EXCLUDE_PATTERNS = [
  '.git',
];

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  // Enumerate available samples dynamically
  let samplesHelp = '';
  try {
    const available = readdirSync(SAMPLES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `    ${e.name}`);
    if (available.length > 0) {
      samplesHelp = `\nAvailable samples:\n${available.join('\n')}\n`;
    }
  } catch {
    // samples dir not present — skip
  }

  console.log(`
Usage: npx @kaleido-io/workflow-engine-sdk init <project-name> [options]

Options:
  --sample <name>  Start from a sample instead of the blank template
  --help, -h       Show this help message
${samplesHelp}
Examples:
  npx @kaleido-io/workflow-engine-sdk init my-provider
  npx @kaleido-io/workflow-engine-sdk init my-provider --sample erc20-indexer
  npx @kaleido-io/workflow-engine-sdk init @my-scope/my-provider
`);
  process.exit(0);
}

const projectName = args[0];

// Check for --sample flag
let sampleName = null;
const sampleFlagIdx = args.indexOf('--sample');
if (sampleFlagIdx !== -1) {
  sampleName = args[sampleFlagIdx + 1];
  if (!sampleName || sampleName.startsWith('--')) {
    console.error('Error: --sample requires a sample name argument.');
    console.error('Run with --help to see available samples.');
    process.exit(1);
  }
}

// Validate project name (npm package name rules: unscoped or @scope/name)
if (!projectNameRegex.test(projectName)) {
  console.error(`Error: Project name "${projectName}" is invalid.`);
  console.error('Project names must contain only lowercase letters, numbers, and hyphens, and optionally a scope prefix.');
  process.exit(1);
}

// Resolve source directory: sample or blank template
let sourceDir;
if (sampleName) {
  sourceDir = join(SAMPLES_DIR, sampleName);
  if (!existsSync(sourceDir)) {
    // List available samples to help the user
    let available = [];
    try {
      available = readdirSync(SAMPLES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // samples dir not present
    }
    console.error(`Error: Sample "${sampleName}" not found.`);
    if (available.length > 0) {
      console.error(`Available samples: ${available.join(', ')}`);
    }
    process.exit(1);
  }
} else {
  sourceDir = TEMPLATE_DIR;
  if (!existsSync(sourceDir)) {
    console.error(`Error: Template directory not found at ${sourceDir}`);
    process.exit(1);
  }
}

// Get current working directory
const cwd = process.cwd();
const targetDir = join(cwd, projectName);

// Check if target directory already exists
if (existsSync(targetDir)) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  console.error('Please choose a different name or remove the existing directory.');
  process.exit(1);
}

// Collect variable values
const variables = {};

// Set default values from config
for (const [key, config] of Object.entries(templateConfig.variables || {})) {
  if (config.default !== undefined) {
    variables[key] = config.default;
  }
}

// Override with project name
variables.PROVIDER_NAME = projectName;

const sourceLabel = sampleName ? `sample: ${sampleName}` : 'blank template';
console.log(`\nCreating new provider project: ${projectName} (from ${sourceLabel})`);
console.log(`Location: ${targetDir}\n`);

// Create target directory
mkdirSync(targetDir, { recursive: true });

// Copy template files (excluding certain patterns)
function shouldExclude(filePath, relativePath) {
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.startsWith('*.')) {
      // File extension pattern (e.g., "*.tgz")
      const ext = pattern.slice(1);
      if (filePath.endsWith(ext)) {
        return true;
      }
    } else if (relativePath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function copyTemplate(src, dest, basePath = '') {
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const relativePath = join(basePath, entry.name);

    if (shouldExclude(srcPath, relativePath)) {
      continue;
    }

    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, relativePath);
    } else if (entry.isFile()) {
      try {
        // Read file content
        let content = readFileSync(srcPath, 'utf-8');

        // Check if this file needs variable replacement
        const fileConfig = templateConfig.files?.[relativePath];
        if (fileConfig && fileConfig.replace) {
          // Replace all template variables
          for (const varName of fileConfig.replace) {
            const value = variables[varName];
            if (value !== undefined) {
              const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
              content = content.replace(regex, value);
            }
          }
        } else {
          // Replace all known variables in any file (in case template.config.json is incomplete)
          for (const [varName, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
            content = content.replace(regex, value);
          }
        }

        writeFileSync(destPath, content, 'utf-8');
      } catch (error) {
        // Skip files that can't be read (permissions, symlinks, etc.)
        console.warn(`Warning: Skipping ${relativePath}: ${error.message}`);
      }
    }
  }
}

// Copy source (template or sample) to target directory
try {
  copyTemplate(sourceDir, targetDir);
} catch (error) {
  console.error(`Error copying template files: ${error.message}`);
  process.exit(1);
}

console.log(`Project ${projectName} initialized\n\n`);
console.log('Next steps:');
console.log(`\tcd ${projectName}`);
console.log('\tnpm install');
console.log('\t# Edit config/wfe-config.yaml with your configuration');
console.log('\tnpm run start:dev\n');
