#!/usr/bin/env node
// TODO: Remove this script before publishing packages to npm.
// It exists solely to allow local testing while @kaleido-io/* packages are not
// yet published to a registry.
//
// Must be run from the repo root (where this package.json lives).
//
// Usage:
//   npm run patch-local-deps -- <path-to-project>                 # patch everything (default)
//   npm run patch-local-deps -- <path-to-project> --no-docker     # skip Dockerfile patch
//   npm run patch-local-deps -- <path-to-project> --no-npm        # skip package.json patch
//
// Default (no flags):
//   Packs each @kaleido-io/* package into tarballs, copies them into
//   .kaleido-local-deps/, patches package.json to use file: paths to those
//   tarballs, and patches the Dockerfile. Covers the full dev cycle:
//   npm install && start:dev for iteration, docker build when ready to deploy.
//
// Full flow:
//   npm run build:packages
//   npm run patch-local-deps -- /tmp/my-project
//   cd /tmp/my-project && npm install && npm run start:dev
//   # ... iterate ...
//   docker build --platform linux/amd64 -t <image>:<tag> /tmp/my-project

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const targetArg = process.argv[2];
const dockerMode = !process.argv.includes('--no-docker');
const npmMode   = !process.argv.includes('--no-npm');

if (!targetArg) {
  console.error('Usage: npm run patch-local-deps -- <path-to-project> [--no-docker] [--no-npm]');
  process.exit(1);
}

const targetDir = resolve(targetArg);
const pkgPath = join(targetDir, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`No package.json found at ${pkgPath}`);
  process.exit(1);
}

// ── Discover local @kaleido-io/* packages ────────────────────────────────────

// @kaleido-io/* packages live under packages/
const searchDirs = ['packages'].map((d) => join(REPO_ROOT, d));
const localPackages = {};   // name → source dir

for (const searchDir of searchDirs) {
  if (!existsSync(searchDir)) continue;
  for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(searchDir, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const { name } = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (name?.startsWith('@kaleido-io/')) {
      localPackages[name] = join(searchDir, entry.name);
    }
  }
}

// ── Resolve dep paths (source dirs or packed tarballs) ───────────────────────

const depPaths = {};   // name → value to write into package.json

// Always pack tarballs — they work for both npm install (local dev) and docker build.
const depsDir = join(targetDir, '.kaleido-local-deps');
mkdirSync(depsDir, { recursive: true });

for (const [name, srcDir] of Object.entries(localPackages)) {
  console.log(`Packing ${name}...`);
  const tgz = execSync('npm pack --quiet', { cwd: srcDir, encoding: 'utf-8' }).trim();
  const srcTgz = join(srcDir, tgz);
  const destTgz = join(depsDir, tgz);
  copyFileSync(srcTgz, destTgz);
  unlinkSync(srcTgz);
  depPaths[name] = `file:.kaleido-local-deps/${tgz}`;
  console.log(`  → ${destTgz}`);
}

// ── Patch package.json ───────────────────────────────────────────────────────

if (npmMode) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const changed = [];

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!pkg[section]) continue;
    for (const [name, newPath] of Object.entries(depPaths)) {
      if (name in pkg[section] && pkg[section][name] !== newPath) {
        changed.push(`  ${name}: "${pkg[section][name]}" → "${newPath}"`);
        pkg[section][name] = newPath;
      }
    }
  }

  if (changed.length > 0) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`\nPatched ${pkgPath}:`);
    for (const line of changed) console.log(line);
  } else {
    console.log('\npackage.json already patched.');
  }
}

// ── Patch Dockerfile ──────────────────────────────────────────────────────────

if (dockerMode) {
  const dockerfilePath = join(targetDir, 'Dockerfile');
  if (!existsSync(dockerfilePath)) {
    console.warn(`\nNo Dockerfile found at ${dockerfilePath} — skipping Dockerfile patch.`);
  } else {
    let dockerfile = readFileSync(dockerfilePath, 'utf-8');
    let dockerChanged = false;

    // Add COPY for .kaleido-local-deps before the first RUN npm command
    if (!dockerfile.includes('.kaleido-local-deps')) {
      dockerfile = dockerfile.replace(
        /^(COPY package\.json.*)/m,
        'COPY .kaleido-local-deps ./.kaleido-local-deps\n$1',
      );
      dockerChanged = true;
    }

    // Drop package-lock.json from the COPY — the lockfile was generated against
    // registry deps, not the local file: paths, so npm install must regenerate it.
    if (dockerfile.includes('package-lock.json')) {
      dockerfile = dockerfile.replace(/\s+package-lock\.json/g, '');
      dockerChanged = true;
    }

    // npm ci requires a lockfile matching package.json exactly — use npm install instead
    let npmCiReplaced = false;
    if (dockerfile.includes('npm ci')) {
      dockerfile = dockerfile.replace(/\bnpm ci\b/g, 'npm install');
      dockerChanged = true;
      npmCiReplaced = true;
    }

    if (dockerChanged) {
      writeFileSync(dockerfilePath, dockerfile, 'utf-8');
      console.log(`\nPatched ${dockerfilePath}:`);
      if (npmCiReplaced) console.log('  npm ci → npm install');
      console.log('  Added: COPY .kaleido-local-deps ./.kaleido-local-deps');
    } else {
      console.log(`\nDockerfile already patched.`);
    }
  }

  console.log('\nReady to build:');
  console.log(`  docker build --platform linux/amd64 -t <image>:<tag> ${targetDir}`);
}

console.log('\nRun `npm install` inside the project for local dev.');
