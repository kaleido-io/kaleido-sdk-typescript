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

import { existsSync, realpathSync, statSync } from 'fs';
import { builtinModules } from 'module';
import { dirname, relative, resolve, sep } from 'path';
import type * as esbuild from 'esbuild';

/** A handler in a snippet package: its name and its source file, relative to the package root. */
export interface PackageHandlerRef {
  name: string;
  entry: string;
}

/**
 * The file a handler's `entry` names inside a package directory. An entry may
 * not point outside the package. `packageName` is only for messages.
 */
export function resolvePackageEntry(handler: PackageHandlerRef, packageDir: string, packageName: string): string {
  const root = resolve(packageDir);
  const path = resolve(root, handler.entry);
  if (!path.startsWith(root + sep)) {
    throw new Error(`Handler "${handler.name}": entry "${handler.entry}" is outside package ${packageName}.`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Handler "${handler.name}": entry "${handler.entry}" is not a file in package ${packageName}.`);
  }
  return path;
}

/** The package a bare import names: `@scope/name` or `name`, without a subpath. */
export function importedPackageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBareImport(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(specifier);
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(importedPackageName(specifier));
}

export interface PackageImportCheck {
  /** What is being bundled, for messages. */
  source: string;
  /** The package directory, by its real path. */
  root: string;
  plugin: esbuild.Plugin;
  /** The imports the package may not make, once the bundle has been built. */
  problems(): string[];
}

/**
 * An esbuild plugin that fails the bundle when a file of the package imports a
 * package that isn't supplied to it, or a path outside the package. Where the
 * package runs (a TypeScript provider, or a developer's machine) whatever else
 * happens to be installed can change or go away, so a package may rely only on
 * the supplied packages and Node.js built-ins. Imports made by files inside
 * node_modules are the supplied packages' own, and aren't checked.
 */
export function packageImportCheck(source: string, packageDir: string, allowed: string[]): PackageImportCheck {
  const problems: string[] = [];
  // esbuild reports importers by their real path, which differs where the directory is under a symlink.
  const root = realpathSync(packageDir);
  const allowedSet = new Set(allowed);
  const report = (problem: string): esbuild.OnResolveResult => {
    if (!problems.includes(problem)) {
      problems.push(problem);
    }
    return { errors: [{ text: problem }] };
  };
  const plugin: esbuild.Plugin = {
    name: 'snippet-package-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point' || args.importer.split(sep).includes('node_modules')) {
          return undefined;
        }
        const importer = relative(root, args.importer).split(sep).join('/');
        if (!isBareImport(args.path)) {
          // A package's own files may reach only other files of the package.
          const target = resolve(dirname(args.importer), args.path);
          if (target === root || target.startsWith(root + sep)) {
            return undefined;
          }
          return report(
            `${importer} imports "${args.path}", which is outside the package. ` +
              `A snippet package can import only its own files by path.`,
          );
        }
        if (isNodeBuiltin(args.path) || allowedSet.has(importedPackageName(args.path))) {
          return undefined;
        }
        return report(
          `${importer} imports "${args.path}", which isn't supplied to snippet packages. ` +
            `A snippet package can import only: ${allowed.join(', ')} and Node.js built-in modules.`,
        );
      });
    },
  };
  return { source, root, plugin, problems: () => [...problems] };
}
