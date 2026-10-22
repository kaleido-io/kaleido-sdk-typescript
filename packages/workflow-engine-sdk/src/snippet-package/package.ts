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
 * Snippet packages: a zip of an npm project whose handlers run in the
 * TypeScript provider. The provider supplies the Kaleido SDKs and zod, so a
 * package carries only its own source: no node_modules, and no dependencies
 * other than those.
 *
 * The same rules run in `ksdk package`, in the artifact registry (which has its
 * own Go implementation of them) and in the TypeScript provider.
 */

import { discoverHandlers, isHandlerSourceFile, manifestFromHandlers, type DiscoverOptions } from './discover';
import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { readZip, writeZip, type ZipEntry, type ZipInput } from './zip';

/** The most entries a package may hold. Source projects are far smaller; this stops archive bombs. */
export const MAX_PACKAGE_ENTRIES = 5000;
/** The most bytes a package may hold once unzipped. */
export const MAX_PACKAGE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** The largest package.json read when checking a package. */
export const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

/** Dependencies in this scope are allowed: the TypeScript provider supplies the Kaleido SDKs. */
export const SUPPORTED_DEPENDENCY_SCOPE = '@kaleido-io/';

/** Libraries outside that scope that the TypeScript provider also supplies, so a package may depend on them. */
export const SUPPLIED_LIBRARIES: readonly string[] = ['zod'];

/** Whether a package may depend on this package name, because the TypeScript provider supplies it. */
export function isSuppliedDependency(name: string): boolean {
  return name.startsWith(SUPPORTED_DEPENDENCY_SCOPE) || SUPPLIED_LIBRARIES.includes(name);
}

/** Path segments left out of a package wherever they appear. */
const EXCLUDED_SEGMENTS = new Set(['node_modules', '.git', '__MACOSX']);
/** File names left out of a package wherever they appear. */
const EXCLUDED_FILES = new Set(['.DS_Store']);
/**
 * Further top-level entries `packSnippetPackage` leaves out of a project. Lockfiles go too: the
 * provider supplies the dependencies, so nothing is ever installed from them.
 */
const EXCLUDED_PROJECT_ROOTS = new Set([
  'dist',
  'coverage',
  '.vscode',
  '.idea',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

export type HandlerKind = 'transactionHandlers' | 'eventSources' | 'eventProcessors';
export const HANDLER_KINDS: HandlerKind[] = ['transactionHandlers', 'eventSources', 'eventProcessors'];

/** A handler a package provides: its name and the source file that exports it. */
export interface SnippetPackageHandler {
  name: string;
  entry: string;
}

/** The `kaleido` section of a package's package.json. */
export type SnippetPackageManifest = Partial<Record<HandlerKind, SnippetPackageHandler[]>>;

export interface SnippetPackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  kaleido?: SnippetPackageManifest;
}

/** A file in a package, at its path relative to the package root. */
export interface SnippetPackageFile {
  path: string;
  entry: ZipEntry;
}

export interface NormalizedSnippetPackage {
  files: SnippetPackageFile[];
  /** What normalising changed, for example `removed node_modules/ (412 entries)`. */
  changes: string[];
}

export interface SnippetPackageCheck {
  /** Everything wrong with the package. Empty when it is valid. */
  problems: string[];
  packageJson?: SnippetPackageJson;
}

const segments = (path: string) => path.split('/').filter((s) => s !== '');

function excludedSegment(path: string): string | undefined {
  const parts = segments(path);
  const excluded = parts.find((s) => EXCLUDED_SEGMENTS.has(s));
  if (excluded) {
    return excluded;
  }
  const last = parts[parts.length - 1];
  return last && EXCLUDED_FILES.has(last) ? last : undefined;
}

/**
 * Prepare an uploaded zip the way the artifact registry does: leave out
 * node_modules, .git, __MACOSX and .DS_Store wherever they are, and move the
 * package root up when every file sits in one top-level directory (as a
 * "compress folder" archive does).
 */
export function normalizeSnippetPackage(entries: ZipEntry[]): NormalizedSnippetPackage {
  const removed = new Map<string, number>();
  const kept = entries.filter((e) => {
    const excluded = excludedSegment(e.path);
    if (excluded) {
      removed.set(excluded, (removed.get(excluded) ?? 0) + 1);
      return false;
    }
    return true;
  });
  // Report in a fixed order, so the same package always reads the same way.
  const order = [...EXCLUDED_SEGMENTS, ...EXCLUDED_FILES];
  const changes = [...removed].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([name, count]) =>
    `removed ${EXCLUDED_FILES.has(name) ? name : `${name}/`} (${count} ${count === 1 ? 'entry' : 'entries'})`);

  let files: SnippetPackageFile[] = kept.filter((e) => !e.isDirectory).map((entry) => ({ path: entry.path, entry }));
  const tops = new Set(files.map((f) => segments(f.path)[0]));
  const hasRootPackageJson = files.some((f) => f.path === 'package.json');
  if (!hasRootPackageJson && tops.size === 1 && files.every((f) => segments(f.path).length > 1)) {
    const [top] = tops;
    files = files.map((f) => ({ path: segments(f.path).slice(1).join('/'), entry: f.entry }));
    changes.push(`moved the package root up from ${top}/`);
  }
  return { files, changes };
}

function unsafePath(path: string): string | undefined {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'is an absolute path';
  }
  if (path.includes('\\')) {
    return 'contains a backslash';
  }
  if (segments(path).includes('..')) {
    return 'contains a .. segment';
  }
  return undefined;
}

function checkDependencies(pkg: SnippetPackageJson, problems: string[]): void {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (!isSuppliedDependency(name)) {
        problems.push(
          `package.json ${section} names "${name}". A snippet package may depend only on ${SUPPORTED_DEPENDENCY_SCOPE}* packages ` +
            `and ${SUPPLIED_LIBRARIES.join(', ')}, which the TypeScript provider supplies. Move build and test tools to devDependencies.`,
        );
      }
    }
  }
}

function checkManifest(pkg: SnippetPackageJson, paths: Set<string>, problems: string[]): void {
  const manifest = pkg.kaleido;
  if (manifest === undefined) {
    return;
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    problems.push('package.json "kaleido" must be an object');
    return;
  }
  const names = new Set<string>();
  for (const kind of HANDLER_KINDS) {
    const handlers = manifest[kind];
    if (handlers === undefined) {
      continue;
    }
    if (!Array.isArray(handlers)) {
      problems.push(`package.json kaleido.${kind} must be an array`);
      continue;
    }
    handlers.forEach((h, i) => {
      const where = `package.json kaleido.${kind}[${i}]`;
      if (!h || typeof h.name !== 'string' || h.name.trim() === '') {
        problems.push(`${where} needs a "name"`);
      } else if (names.has(h.name)) {
        problems.push(`${where}: handler name "${h.name}" is used more than once`);
      } else {
        names.add(h.name);
      }
      if (!h || typeof h.entry !== 'string' || h.entry.trim() === '') {
        problems.push(`${where} needs an "entry" file`);
      } else if (!paths.has(h.entry)) {
        problems.push(`${where}: entry "${h.entry}" is not in the package`);
      }
    });
  }
}

/** Check a normalised package against the snippet package rules. */
export function checkSnippetPackage(files: SnippetPackageFile[]): SnippetPackageCheck {
  const problems: string[] = [];
  if (files.length === 0) {
    return { problems: ['the package is empty'] };
  }
  if (files.length > MAX_PACKAGE_ENTRIES) {
    problems.push(`the package has ${files.length} files; the most allowed is ${MAX_PACKAGE_ENTRIES}`);
  }
  let total = 0;
  for (const { path, entry } of files) {
    total += entry.uncompressedSize;
    const unsafe = unsafePath(path);
    if (unsafe) {
      problems.push(`${path} ${unsafe}`);
    }
    if (entry.isSymlink) {
      problems.push(`${path} is a symbolic link, which a package can't contain`);
    }
    if (excludedSegment(path) === 'node_modules') {
      problems.push(`${path} is in node_modules. The TypeScript provider supplies the SDKs; leave node_modules out.`);
    }
  }
  if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
    problems.push(`the package unzips to ${total} bytes; the most allowed is ${MAX_PACKAGE_UNCOMPRESSED_BYTES}`);
  }

  const packageJsonFile = files.find((f) => f.path === 'package.json');
  if (!packageJsonFile) {
    problems.push('the package has no package.json at its root');
    return { problems };
  }
  if (packageJsonFile.entry.uncompressedSize > MAX_PACKAGE_JSON_BYTES) {
    problems.push(`package.json is larger than ${MAX_PACKAGE_JSON_BYTES} bytes`);
    return { problems };
  }
  let packageJson: SnippetPackageJson;
  try {
    const parsed = JSON.parse(packageJsonFile.entry.read().toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    packageJson = parsed as SnippetPackageJson;
  } catch (error) {
    problems.push(`package.json is not a valid JSON object: ${error instanceof Error ? error.message : String(error)}`);
    return { problems };
  }
  checkDependencies(packageJson, problems);
  checkManifest(packageJson, new Set(files.map((f) => f.path)), problems);
  return { problems, packageJson };
}

/** Read, normalise and check a snippet package zip. */
export function inspectSnippetPackage(zip: Buffer): NormalizedSnippetPackage & SnippetPackageCheck {
  const normalized = normalizeSnippetPackage(readZip(zip));
  return { ...normalized, ...checkSnippetPackage(normalized.files) };
}

export class SnippetPackageError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid snippet package:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SnippetPackageError';
  }
}

/**
 * Unzip a snippet package into a directory, after normalising and checking it.
 * Throws a SnippetPackageError listing every problem when it isn't valid.
 */
export function extractSnippetPackage(zip: Buffer, directory: string): NormalizedSnippetPackage & SnippetPackageCheck {
  const inspected = inspectSnippetPackage(zip);
  if (inspected.problems.length > 0) {
    throw new SnippetPackageError(inspected.problems);
  }
  const root = resolve(directory);
  for (const { path, entry } of inspected.files) {
    const target = resolve(root, path);
    if (!target.startsWith(root + sep)) {
      throw new SnippetPackageError([`${path} would be written outside the package directory`]);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.read());
  }
  return inspected;
}

/**
 * The untracked files git ignores under `directory`, as paths relative to it (a directory ends in
 * `/`), or undefined when it isn't in a git work tree or git isn't installed. Git applies every
 * .gitignore above and below the directory and the user's own excludes, so a file ignored only
 * by the repository's root .gitignore, such as a local config holding credentials, stays out.
 */
function gitIgnored(directory: string): Set<string> | undefined {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '.'], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(out.toString('utf8').split('\0').filter((p) => p !== ''));
  } catch {
    return undefined;
  }
}

function gitignorePatternRegExp(body: string): RegExp {
  const source = body
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      switch (part) {
        case '**/':
          return '(?:.*/)?';
        case '**':
          return '.*';
        case '*':
          return '[^/]*';
        case '?':
          return '[^/]';
        default:
          return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
    })
    .join('');
  return new RegExp('^' + source + '$');
}

/** Whether git, or failing that the directory's own .gitignore, leaves out a path relative to it. */
function ignoredByGitignore(directory: string): (relPath: string) => boolean {
  const fromGit = gitIgnored(directory);
  if (fromGit) {
    return (rel) => {
      if (fromGit.has(rel)) {
        return true;
      }
      const parts = segments(rel);
      return parts.some((_, i) => i < parts.length - 1 && fromGit.has(parts.slice(0, i + 1).join('/') + '/'));
    };
  }
  let patterns: string[] = [];
  try {
    patterns = readFileSync(join(directory, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'));
  } catch {
    // no .gitignore
  }
  // Without git: a pattern with a slash before its end is a path from the directory
  // (`config/local.yaml`, `/dist`); one without matches a name at any depth (`*.log`, `logs/`).
  // Either one also leaves out everything under a directory it matches.
  const matchers = patterns.map((p) => {
    const body = p.replace(/\/$/, '');
    const isPath = body.includes('/');
    const re = gitignorePatternRegExp(body.replace(/^\//, ''));
    return (rel: string) => {
      const parts = segments(rel);
      if (isPath) {
        return parts.some((_, i) => re.test(parts.slice(0, i + 1).join('/')));
      }
      return parts.some((s) => re.test(s));
    };
  });
  return (rel) => matchers.some((m) => m(rel));
}

/**
 * Zip a project directory as a snippet package: every file except
 * node_modules, .git, build output, editor settings, anything .gitignore
 * names, and earlier package zips.
 */
/** What `packSnippetPackage` built, and where its handler list came from. */
export interface PackedSnippetPackage {
  /** The zip, ready to upload. */
  zip: Buffer;
  /** The files in the zip, relative to the package root. */
  files: string[];
  /**
   * `package.json` when the project lists its handlers in a "kaleido" section,
   * which is used as it is; `code` when the list was found in the source and
   * written into the zip's package.json, leaving the project's untouched.
   */
  handlerSource: 'package.json' | 'code';
  /** The handlers the zip's package.json lists. */
  handlers: SnippetPackageManifest;
  /** Handlers that couldn't be listed from the source; the zip is not usable while there are any. */
  problems: string[];
  /** Differences between a "kaleido" section and the source, which don't stop the package. */
  warnings: string[];
}

/**
 * Zip a snippet package project, leaving out node_modules, build output,
 * lockfiles, files `.gitignore` names and earlier zips. When the project's
 * package.json has no "kaleido" section, the handlers are found in the source
 * and listed in the zip's package.json.
 */
export function packSnippetPackage(directory: string, options: DiscoverOptions = {}): PackedSnippetPackage {
  const ignored = ignoredByGitignore(directory);
  const inputs: ZipInput[] = [];
  const walk = (dir: string) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      const rel = relative(directory, full).split(sep).join('/');
      if (excludedSegment(rel) || ignored(rel) || (dir === directory && EXCLUDED_PROJECT_ROOTS.has(dirent.name))) {
        continue;
      }
      if (dirent.isSymbolicLink()) {
        continue;
      }
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile() && !(dir === directory && rel.endsWith('.zip'))) {
        inputs.push({ path: rel, content: readFileSync(full) });
      }
    }
  };
  if (!statSync(directory).isDirectory()) {
    throw new Error(`${directory} is not a directory`);
  }
  walk(directory);

  const sources: Record<string, string> = {};
  for (const input of inputs) {
    if (isHandlerSourceFile(input.path)) {
      sources[input.path] = input.content.toString('utf8');
    }
  }
  const discovery = discoverHandlers(sources, options);
  const packageJsonInput = inputs.find((i) => i.path === 'package.json');
  let pkg: SnippetPackageJson | undefined;
  try {
    pkg = packageJsonInput ? JSON.parse(packageJsonInput.content.toString('utf8')) : undefined;
  } catch {
    pkg = undefined;
  }

  let result: Omit<PackedSnippetPackage, 'zip' | 'files'>;
  if (pkg && typeof pkg === 'object' && pkg.kaleido !== undefined) {
    const listed = new Set(HANDLER_KINDS.flatMap((kind) => (Array.isArray(pkg?.kaleido?.[kind]) ? pkg!.kaleido![kind]! : []).map((h) => h?.entry)));
    const warnings = discovery.handlers
      .filter((h) => !listed.has(h.entry))
      .map((h) => `${h.entry} defines handler "${h.name}", which the package.json "kaleido" section doesn't list, so it won't be offered`);
    result = { handlerSource: 'package.json', handlers: pkg.kaleido, problems: [], warnings };
  } else {
    const handlers = manifestFromHandlers(discovery.handlers);
    if (pkg && typeof pkg === 'object' && packageJsonInput && discovery.problems.length === 0) {
      packageJsonInput.content = Buffer.from(JSON.stringify({ ...pkg, kaleido: handlers }, null, 2) + '\n');
    }
    result = { handlerSource: 'code', handlers, problems: discovery.problems, warnings: [] };
  }
  return { zip: writeZip(inputs), files: inputs.map((i) => i.path).sort(), ...result };
}
