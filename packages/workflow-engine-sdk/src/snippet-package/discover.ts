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
 * Finding a snippet package's handlers in its source, without running it, to
 * write the package.json "kaleido" section for a package that has none.
 */

import type { HandlerKind, SnippetPackageHandler, SnippetPackageManifest } from './package';
import { HANDLER_NAME_RULE, isValidHandlerName } from '../handlers/define';

const DEFINERS: Record<string, HandlerKind> = {
  defineTransactionHandler: 'transactionHandlers',
  defineEventSource: 'eventSources',
  defineProcessor: 'eventProcessors',
};

/** A handler found in a package's source. */
export interface DiscoveredHandler {
  /** The section of the package.json "kaleido" section the handler belongs in. */
  kind: HandlerKind;
  /** The name the handler is defined with, or the file's name when it has none. */
  name: string;
  /** The file, relative to the package root. */
  entry: string;
  /** True when the name came from the code rather than the file's name. */
  named: boolean;
}

/** What `discoverHandlers` found. */
export interface HandlerDiscovery {
  /** The handlers, in file order. */
  handlers: DiscoveredHandler[];
  /** Why handlers couldn't be listed; a package with any isn't usable until they are fixed. */
  problems: string[];
}

/** How `discoverHandlers` reads the source. */
export interface DiscoverOptions {
  /**
   * The TypeScript compiler module (`import * as ts from 'typescript'`). With
   * it, files are parsed properly; without it, a simpler reading of the source
   * finds only `export const x = define…(…)` written on one statement, and
   * reports anything it can't read rather than guessing.
   */
  typescript?: unknown;
}

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts'];
const TEST_DIRECTORIES = new Set(['test', 'tests', '__tests__', 'node_modules', 'dist']);

/** True for a file that can hold a handler: TypeScript source outside the tests and build output. */
export function isHandlerSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext)) || path.endsWith('.d.ts')) {
    return false;
  }
  if (/\.(test|spec)\.[cm]?ts$/.test(path)) {
    return false;
  }
  return !path.split('/').some((segment) => TEST_DIRECTORIES.has(segment));
}

function baseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.[cm]?ts$/, '');
}

interface Found {
  definer: string;
  /** The literal name, when the first argument is one. */
  literal?: string;
  /** The first argument is neither a string literal nor clearly the handler's body. */
  nonLiteralName?: boolean;
  /** A definer is called in a form the reading without the compiler doesn't follow. */
  unreadable?: boolean;
}

/**
 * Find the handlers in a package's source files, keyed by path relative to the
 * package root. Only source files that can hold a handler are read.
 */
export function discoverHandlers(files: Record<string, string>, options: DiscoverOptions = {}): HandlerDiscovery {
  const handlers: DiscoveredHandler[] = [];
  const problems: string[] = [];
  for (const path of Object.keys(files).sort()) {
    if (!isHandlerSourceFile(path)) {
      continue;
    }
    const found = options.typescript ? findWithCompiler(options.typescript, path, files[path]) : findWithPatterns(files[path]);
    if (found.length > 1) {
      problems.push(`${path} exports ${found.length} handlers (${found.map((f) => f.definer).join(', ')}); a TypeScript provider loads one handler per file, so move each into a file of its own`);
      continue;
    }
    if (found.length === 0) {
      continue;
    }
    const [handler] = found;
    if (handler.unreadable) {
      problems.push(`${path} defines a handler in a form that can't be read without the TypeScript compiler; add typescript to the project's devDependencies, or list the handler in a package.json "kaleido" section`);
      continue;
    }
    if (handler.nonLiteralName || (handler.definer === 'defineEventSource' && handler.literal === undefined)) {
      problems.push(`${path}: give ${handler.definer} its handler name as a string literal, such as ${handler.definer}('${baseName(path)}', …), so it can be read without running the code`);
      continue;
    }
    const name = handler.literal ?? baseName(path);
    if (!isValidHandlerName(name)) {
      problems.push(
        handler.literal !== undefined
          ? `${path}: handler name "${name}" must be ${HANDLER_NAME_RULE}`
          : `${path}: the file name gives the handler the name "${name}", which must be ${HANDLER_NAME_RULE}; rename the file or name the handler in its ${handler.definer} call`,
      );
      continue;
    }
    handlers.push({
      kind: DEFINERS[handler.definer],
      name,
      entry: path,
      named: handler.literal !== undefined,
    });
  }
  const byName = new Map<string, DiscoveredHandler>();
  for (const handler of handlers) {
    const other = byName.get(handler.name);
    if (other) {
      problems.push(`${other.entry} and ${handler.entry} both define a handler named "${handler.name}"; handler names must be unique in a package`);
    } else {
      byName.set(handler.name, handler);
    }
  }
  return { handlers, problems };
}

/** The package.json "kaleido" section that lists the handlers. */
export function manifestFromHandlers(handlers: DiscoveredHandler[]): SnippetPackageManifest {
  const manifest: SnippetPackageManifest = {};
  for (const handler of handlers) {
    const entry: SnippetPackageHandler = { name: handler.name, entry: handler.entry };
    (manifest[handler.kind] ??= []).push(entry);
  }
  return manifest;
}

// The compiler API is used through `any`: the SDK does not depend on the
// typescript package, which comes from the project being packaged.
function findWithCompiler(tsModule: unknown, path: string, source: string): Found[] {
  const ts = tsModule as any;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const unwrap = (node: any): any => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node))) {
      node = node.expression;
    }
    return node;
  };
  const definerCall = (node: any): Found | undefined => {
    const call = unwrap(node);
    if (!call || !ts.isCallExpression(call)) {
      return undefined;
    }
    const callee = call.expression;
    const definer = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
    if (!definer || !(definer in DEFINERS)) {
      return undefined;
    }
    const [first, second] = call.arguments;
    const isLiteral = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first));
    if (isLiteral) {
      return { definer, literal: first.text };
    }
    // A name is the first of two arguments; with one, the argument is the handler itself.
    const namedPosition = definer === 'defineEventSource' || second !== undefined;
    return { definer, nonLiteralName: namedPosition };
  };
  const exported = (node: any) => (ts.getCombinedModifierFlags?.(node) ?? 0) & ts.ModifierFlags.Export;
  const locals = new Map<string, Found>();
  const found: Found[] = [];
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const call = declaration.initializer ? definerCall(declaration.initializer) : undefined;
        if (!call || !ts.isIdentifier(declaration.name)) {
          continue;
        }
        if (exported(declaration)) {
          found.push(call);
        } else {
          locals.set(declaration.name.text, call);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const call = definerCall(statement.expression);
      if (call) {
        found.push(call);
      } else if (ts.isIdentifier(statement.expression) && locals.has(statement.expression.text)) {
        found.push(locals.get(statement.expression.text)!);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        const call = locals.get(local);
        if (call) {
          found.push(call);
        }
      }
    }
  }
  return found;
}

// Without the compiler: comments are blanked out, then each `export const x =
// define…(` is matched and the first argument read. Anything else that calls a
// definer is reported as unreadable rather than guessed at.
function findWithPatterns(source: string): Found[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const found: Found[] = [];
  const pattern = /export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(defineTransactionHandler|defineEventSource|defineProcessor)\s*(?:<[^(]*>)?\s*\(\s*/g;
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    const definer = match[1];
    const rest = code.slice(pattern.lastIndex);
    const literal = /^(['"`])([^'"`\n]*)\1/.exec(rest);
    if (literal) {
      found.push({ definer, literal: literal[2] });
    } else if (definer === 'defineEventSource') {
      found.push({ definer, nonLiteralName: true });
    } else if (/^(\{|async\b|function\b|\()/.test(rest)) {
      found.push({ definer });
    } else {
      // An identifier or other expression: the handler itself, or a name in a variable.
      found.push({ definer, nonLiteralName: true });
    }
  }
  const calls = (code.match(/\b(defineTransactionHandler|defineEventSource|defineProcessor)\s*(?:<[^(]*>)?\s*\(/g) ?? []).length;
  if (calls > found.length && found.length === 0) {
    // Defined in a form this reading doesn't follow, such as a local constant exported later.
    found.push({ definer: 'unknown', unreadable: true });
  }
  return found;
}
