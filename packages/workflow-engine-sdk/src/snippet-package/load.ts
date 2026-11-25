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

import { statSync } from 'fs';
import { readFile } from 'fs/promises';
import { builtinModules } from 'module';
import { dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';
import type * as esbuild from 'esbuild';
import type { PackageImportCheck } from './imports';

const nodeBuiltinExternals = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Bounds on bundling a handler. Bundling turns handler source into code that
 * runs, so the work it can trigger is limited; each limit can be raised with
 * its environment variable for handlers that are legitimately large.
 */
export interface HandlerBundleLimits {
  /** `HANDLER_BUNDLE_TIMEOUT_MS`, default 30 seconds. */
  timeoutMs: number;
  /** `MAX_HANDLER_SOURCE_BYTES`, default 5 MiB: the entry file. */
  maxSourceBytes: number;
  /** `MAX_HANDLER_BUNDLE_BYTES`, default 20 MiB: the bundle. */
  maxBundleBytes: number;
}

export function handlerBundleLimits(): HandlerBundleLimits {
  return {
    timeoutMs: positiveIntFromEnv('HANDLER_BUNDLE_TIMEOUT_MS', 30_000),
    maxSourceBytes: positiveIntFromEnv('MAX_HANDLER_SOURCE_BYTES', 5 * 1024 * 1024),
    maxBundleBytes: positiveIntFromEnv('MAX_HANDLER_BUNDLE_BYTES', 20 * 1024 * 1024),
  };
}

export interface BundleHandlerOptions {
  /** Checks the imports of a snippet package's files; also makes `require` resolve from the package. */
  importCheck?: PackageImportCheck;
  /** Directory bare imports resolve from, as esbuild's absWorkingDir. Defaults to the current directory. */
  workingDir?: string;
  /** Further node_modules directories bare imports resolve from, such as a provider's own. */
  nodePaths?: string[];
  /** Import specifiers to replace with a file, such as a module a provider supplies under its own name. */
  alias?: Record<string, string>;
  /** Base `require` resolves from when there's no import check. Defaults to the entry's directory. */
  requireFrom?: string;
  limits?: HandlerBundleLimits;
  /** Adds to esbuild's message when bundling fails, for example with the versions of the supplied packages. */
  explainError?: (message: string) => string;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    // Don't keep the event loop alive solely for this guard.
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const sourceLoaders: Record<string, esbuild.Loader> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
};

// The names of the directory and file name variables Node.js gives a CommonJS
// module. They're assembled because the build's tsc-esm-fix step rewrites
// every literal occurrence of them in compiled code, strings included.
const DIRNAME = '__' + 'dirname';
const FILENAME = '__' + 'filename';

/**
 * Gives each bundled file that uses the directory or file name variables of
 * a CommonJS module its own values, as Node.js does. A bundle runs as one ES
 * module, where neither exists, so without this a CommonJS handler, or a
 * CommonJS package it uses, fails when it reads them. A file that declares
 * either name itself keeps its own.
 */
const modulePathsPlugin: esbuild.Plugin = {
  name: 'module-paths',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      if (!source.includes(DIRNAME) && !source.includes(FILENAME)) {
        return undefined;
      }
      const declarations: string[] = [];
      for (const [name, value] of [
        [DIRNAME, dirname(args.path)],
        [FILENAME, args.path],
      ]) {
        const used = new RegExp(`\\b${name}\\b`).test(source);
        const declared = new RegExp(`\\b(?:var|let|const|function|class)\\s+${name}\\b`).test(source);
        if (used && !declared) {
          declarations.push(`${name} = ${JSON.stringify(value)}`);
        }
      }
      if (declarations.length === 0) {
        return undefined;
      }
      // On the first line, so esbuild's error positions still match the
      // source, but after a hashbang, which must come first.
      const preamble = `var ${declarations.join(', ')};`;
      const hashbang = /^#![^\n]*\n/.exec(source)?.[0] ?? '';
      return { contents: hashbang + preamble + source.slice(hashbang.length), loader: sourceLoaders[extname(args.path)] };
    });
  },
};

async function loadEsbuild(): Promise<typeof esbuild> {
  try {
    return await import('esbuild');
  } catch (error) {
    throw new Error('Loading snippet package handlers needs esbuild. Install it alongside @kaleido-io/workflow-engine-sdk.', { cause: error });
  }
}

/**
 * Bundle one handler's entry file and everything it imports into a single ES
 * module. Each handler is bundled on its own, so modules the handlers of a
 * package share are copied into each bundle and any state they keep at module
 * level is the handler's own: the same wherever the package runs.
 */
export async function bundleHandler(entryPath: string, options: BundleHandlerOptions = {}): Promise<string> {
  const limits = options.limits ?? handlerBundleLimits();
  let size: number | undefined;
  try {
    size = statSync(entryPath).size;
  } catch {
    // If the entry can't be read, esbuild says why.
  }
  if (size !== undefined && size > limits.maxSourceBytes) {
    throw new Error(`Handler source at ${entryPath} is ${size} bytes, exceeding the maximum of ${limits.maxSourceBytes} bytes.`);
  }

  const { importCheck } = options;
  const build = await loadEsbuild();
  let result: esbuild.BuildResult;
  try {
    result = await withTimeout(
      build.build({
        entryPoints: [entryPath],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        absWorkingDir: options.workingDir ?? process.cwd(),
        nodePaths: options.nodePaths ?? [],
        packages: 'bundle',
        external: nodeBuiltinExternals,
        alias: options.alias ?? {},
        plugins: importCheck ? [importCheck.plugin, modulePathsPlugin] : [modulePathsPlugin],
        logLevel: 'silent',
      }),
      limits.timeoutMs,
      `esbuild bundling exceeded the timeout of ${limits.timeoutMs}ms`,
    );
  } catch (error) {
    const importProblems = importCheck?.problems() ?? [];
    if (importProblems.length > 0) {
      throw new Error(`Failed to bundle ${importCheck!.source}:\n${importProblems.join('\n')}`, { cause: error });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to bundle handler at ${entryPath}: ${options.explainError ? options.explainError(message) : message}`, { cause: error });
  }

  // esbuild keeps an entry's hashbang as the bundle's first line, where it
  // would land after the require line added below and fail to parse.
  const bundled = result.outputFiles?.[0]?.text.replace(/^#![^\n]*\n/, '');
  if (!bundled) {
    throw new Error(`Failed to bundle handler at ${entryPath}: esbuild produced no output`);
  }
  const bundledBytes = Buffer.byteLength(bundled);
  if (bundledBytes > limits.maxBundleBytes) {
    throw new Error(`Bundled handler at ${entryPath} is ${bundledBytes} bytes, exceeding the maximum of ${limits.maxBundleBytes} bytes.`);
  }

  // A package's require resolves from the package's own directory, so a specifier
  // computed at run time can't reach whatever else is installed nearby. Node.js
  // built-ins still resolve.
  const requireBase = pathToFileURL(join(importCheck?.root ?? options.requireFrom ?? join(entryPath, '..'), '/')).href;
  return `import { createRequire } from 'module';\nconst require = createRequire(${JSON.stringify(requireBase)});\n` + bundled;
}

/** Run a bundled handler module and return its exports. `cacheBust` makes a reload evaluate it afresh. */
export async function evaluateHandlerBundle(code: string, cacheBust?: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}` + (cacheBust ? `#${encodeURIComponent(cacheBust)}` : '');
  return (await import(url)) as Record<string, unknown>;
}
