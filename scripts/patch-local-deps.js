#!/usr/bin/env node
// TODO: Remove this script before publishing packages to npm.
// It exists solely to allow local testing of `npx ksdk init` while
// @kaleido-io/* packages are not yet published to a registry.
//
// Must be run from the repo root (where this package.json lives).
// Pass the absolute path to the initialised project as the argument.
//
// Full local dev flow:
//   # 1. From repo root — build and pack
//   npm run build:packages
//   cd packages/samples && npm pack && cd ../..
//
//   # 2. Init into a temp dir (use absolute path, no globs)
//   TARBALL=$PWD/packages/samples/kaleido-io-samples-1.0.0.tgz
//   mkdir /tmp/my-erc20 && cd /tmp/my-erc20
//   WESDK_REPO_URL="/path/to/kaleido-sdk-typescript" npx "file:$TARBALL" init my-erc20-indexer --template erc20-indexer
//
//   # 3. Back to repo root — patch deps, then install and run
//   cd /path/to/kaleido-sdk-typescript
//   npm run patch-local-deps -- /tmp/my-erc20/my-erc20-indexer
//   cd /tmp/my-erc20/my-erc20-indexer && npm install && npm run start:dev

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('Usage: npm run patch-local-deps -- <path-to-project>');
  process.exit(1);
}

const targetDir = resolve(targetArg);
const pkgPath = join(targetDir, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`No package.json found at ${pkgPath}`);
  process.exit(1);
}

// Discover local @kaleido-io/* packages by scanning packages/
const localPackages = {};
const packagesDir = join(REPO_ROOT, 'packages');
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(packagesDir, entry.name, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (name?.startsWith('@kaleido-io/')) {
    localPackages[name] = `file:${join(packagesDir, entry.name)}`;
  }
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const changed = [];

for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  if (!pkg[section]) continue;
  for (const [dep, localPath] of Object.entries(localPackages)) {
    if (dep in pkg[section] && pkg[section][dep] !== localPath) {
      const old = pkg[section][dep];
      pkg[section][dep] = localPath;
      changed.push(`  ${dep}: "${old}" → "${localPath}"`);
    }
  }
}

if (changed.length === 0) {
  console.log('Nothing to patch — all @kaleido-io/* deps already use file: paths or are absent.');
  process.exit(0);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`Patched ${pkgPath}:`);
for (const line of changed) console.log(line);
console.log('\nRun `npm install` inside the project to apply.');
