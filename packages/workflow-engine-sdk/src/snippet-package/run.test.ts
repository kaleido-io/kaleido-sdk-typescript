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

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { extractActionMap, extractEventProcessorDef, extractEventSource } from './extract';
import { packageImportCheck, resolvePackageEntry } from './imports';
import { bundleHandler } from './load';
import { planSnippetPackage, readHandlerConfigFile } from './run';

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
};

const bundle = (dir: string, entry: string, supplied = ['zod']) =>
  bundleHandler(resolvePackageEntry({ name: 'h', entry }, dir, 'acme'), {
    importCheck: packageImportCheck(`${entry} in package acme`, dir, supplied),
    workingDir: dir,
  });

describe('resolvePackageEntry', () => {
  it('finds an entry in the package and refuses one outside it or missing', () => {
    const dir = project({ 'src/a.ts': 'export {}' });
    expect(resolvePackageEntry({ name: 'a', entry: 'src/a.ts' }, dir, 'acme')).toBe(join(dir, 'src/a.ts'));
    expect(() => resolvePackageEntry({ name: 'a', entry: '../a.ts' }, dir, 'acme')).toThrow('outside package acme');
    expect(() => resolvePackageEntry({ name: 'a', entry: 'src/b.ts' }, dir, 'acme')).toThrow('is not a file in package acme');
  });
});

describe('bundleHandler', () => {
  it("bundles a handler with its package's files and supplied packages, with require resolving from the package", async () => {
    const dir = project({
      'node_modules/zod/package.json': '{"name":"zod","main":"index.js"}',
      'node_modules/zod/index.js': 'exports.z = "zod";',
      'src/lib/shared.ts': 'export const seen: string[] = [];',
      'src/a.ts': "import { z } from 'zod';\nimport { seen } from './lib/shared';\nimport { join } from 'node:path';\nexport const a = [z, seen, join];",
    });
    const code = await bundle(dir, 'src/a.ts');
    expect(code).toContain('exports.z = "zod"');
    expect(code).toContain(JSON.stringify(pathToFileURL(join(realpathSync(dir), '/')).href));
  });

  it("copies a shared module into each handler's bundle, so state kept in it is each handler's own", async () => {
    const dir = project({
      'src/lib/cache.ts': 'export const cache = new Map<string, number>();',
      'src/a.ts': "import { cache } from './lib/cache';\nexport const a = cache;",
      'src/b.ts': "import { cache } from './lib/cache';\nexport const b = cache;",
    });
    for (const entry of ['src/a.ts', 'src/b.ts']) {
      expect(await bundle(dir, entry)).toContain('new Map()');
    }
  });

  it('refuses a package that imports what is not supplied, or a path outside it', async () => {
    const dir = project({
      'node_modules/lodash/index.js': 'module.exports = {};',
      'src/a.ts': "import _ from 'lodash';\nexport const a = _;",
      'src/b.ts': "import { x } from '../../outside';\nexport const b = x;",
    });
    await expect(bundle(dir, 'src/a.ts')).rejects.toThrow(`src/a.ts imports "lodash", which isn't supplied to snippet packages`);
    await expect(bundle(dir, 'src/b.ts')).rejects.toThrow('which is outside the package');
  });

  it('refuses an entry larger than the limit', async () => {
    const dir = project({ 'src/a.ts': `export const a = "${'x'.repeat(100)}";` });
    await expect(
      bundleHandler(join(dir, 'src/a.ts'), { workingDir: dir, limits: { timeoutMs: 30_000, maxSourceBytes: 10, maxBundleBytes: 1_000_000 } }),
    ).rejects.toThrow('exceeding the maximum of 10 bytes');
  });

  it('adds the caller’s explanation to a bundling error', async () => {
    const dir = project({ 'src/a.ts': "import { nope } from './missing';\nexport const a = nope;" });
    await expect(bundleHandler(join(dir, 'src/a.ts'), { workingDir: dir, explainError: (m) => `${m}\n(explained)` })).rejects.toThrow('(explained)');
  });
});

describe('extract', () => {
  it('finds a handler of each kind among the exports', () => {
    const actionMap = new Map([['go', { invoke: () => undefined }]]);
    expect(extractActionMap({ actionMap }, 'h', 'h.ts', '/h.ts')).toBe(actionMap);
    const source = { name: 'ticker', eventSourcePoll: () => undefined };
    expect(extractEventSource({ eventSource: source }, 'ticker', 't.ts', '/t.ts')).toBe(source);
    const processBatch = () => undefined;
    expect(extractEventProcessorDef({ processBatch }, 'p', 'p.ts', '/p.ts')).toEqual({ processBatch });
    expect(() => extractActionMap({ other: 1 }, 'h', 'h.ts', '/h.ts')).toThrow('exports: other');
  });

  it('registers an event source under the name it is given', () => {
    const source = { name: 'old', eventSourcePoll: () => undefined };
    expect(extractEventSource({ eventSource: source }, 'new', 't.ts', '/t.ts').name).toBe('new');
  });
});

describe('planSnippetPackage', () => {
  const handlerFile = (kind: string, name: string) =>
    `import { ${kind} } from '@kaleido-io/workflow-engine-sdk';\nexport const h = ${kind}('${name}', {});\n`;
  let savedConfigFile: string | undefined;
  beforeEach(() => {
    savedConfigFile = process.env.CONFIG_FILE;
    delete process.env.CONFIG_FILE;
  });
  afterEach(() => {
    if (savedConfigFile === undefined) {
      delete process.env.CONFIG_FILE;
    } else {
      process.env.CONFIG_FILE = savedConfigFile;
    }
  });

  const base = {
    'package.json': JSON.stringify({ name: 'acme', dependencies: { '@kaleido-io/workflow-engine-sdk': '^1.1.0', zod: '^4', lodash: '^4' } }),
    'src/pay.ts': handlerFile('defineTransactionHandler', 'pay'),
    'src/feed.ts': handlerFile('defineProcessor', 'feed'),
  };

  it("lists the handlers the zip would, the supplied dependencies, and the conventional default config", () => {
    const dir = project({ ...base, 'config/provider-config.yaml': 'book: primary\n' });
    const plan = planSnippetPackage(dir);
    expect(plan.packageName).toBe('acme');
    expect(plan.handlers).toEqual([
      { kind: 'transactionHandlers', name: 'pay', entry: 'src/pay.ts' },
      { kind: 'eventProcessors', name: 'feed', entry: 'src/feed.ts' },
    ]);
    expect(plan.supplied).toEqual(['@kaleido-io/workflow-engine-sdk', 'zod']);
    expect(plan.defaultConfigFile).toBe(join(dir, 'config/provider-config.yaml'));
    expect(plan.handlerConfigFiles).toEqual({});
    expect(readHandlerConfigFile(plan.defaultConfigFile!)).toEqual({ book: 'primary' });
  });

  it('takes the default config from the option, then CONFIG_FILE, then package.json, and a handler’s own from handlerConfig', () => {
    const dir = project({
      ...base,
      'package.json': JSON.stringify({
        name: 'acme',
        dependencies: { zod: '^4' },
        kaleido: { config: 'config/shared.yaml', handlerConfig: { feed: 'config/feed.yaml' } },
      }),
      'config/provider-config.yaml': 'a: 1\n',
      'config/shared.yaml': 'a: 2\n',
      'config/local.yaml': 'a: 3\n',
      'config/feed.yaml': 'a: 4\n',
    });
    expect(planSnippetPackage(dir).defaultConfigFile).toBe(join(dir, 'config/shared.yaml'));
    process.env.CONFIG_FILE = 'config/local.yaml';
    expect(planSnippetPackage(dir).defaultConfigFile).toBe(join(dir, 'config/local.yaml'));
    expect(planSnippetPackage(dir, { configFile: 'config/provider-config.yaml' }).defaultConfigFile).toBe(join(dir, 'config/provider-config.yaml'));
    expect(planSnippetPackage(dir).handlerConfigFiles).toEqual({ feed: join(dir, 'config/feed.yaml') });
  });

  it('has no default config when the package names none and has no conventional file', () => {
    expect(planSnippetPackage(project(base)).defaultConfigFile).toBeUndefined();
  });
});

describe('readHandlerConfigFile', () => {
  it('reads YAML or JSON objects and refuses anything else', () => {
    const dir = project({ 'a.yaml': 'x: 1\n', 'b.json': '{"y":2}', 'c.yaml': '- 1\n', 'd.yaml': '' });
    expect(readHandlerConfigFile(join(dir, 'a.yaml'))).toEqual({ x: 1 });
    expect(readHandlerConfigFile(join(dir, 'b.json'))).toEqual({ y: 2 });
    expect(() => readHandlerConfigFile(join(dir, 'c.yaml'))).toThrow('must hold an object');
    expect(readHandlerConfigFile(join(dir, 'd.yaml'))).toEqual({});
    expect(() => readHandlerConfigFile(join(dir, 'missing.yaml'))).toThrow("can't be read");
  });
});
