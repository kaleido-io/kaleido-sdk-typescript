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

import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as typescript from 'typescript';

import { readZip, writeZip, ZipFormatError } from './zip';
import {
  MAX_PACKAGE_ENTRIES,
  SnippetPackageError,
  isSuppliedDependency,
  checkSnippetPackage,
  extractSnippetPackage,
  inspectSnippetPackage,
  normalizeSnippetPackage,
  packSnippetPackage,
} from './package';

const pkgJson = (extra: Record<string, unknown> = {}) => JSON.stringify({
  name: 'acme-handlers',
  version: '1.0.0',
  dependencies: { '@kaleido-io/workflow-engine-sdk': '^1.1.0' },
  devDependencies: { vitest: '^4.0.0', typescript: '^5.9.0' },
  kaleido: { transactionHandlers: [{ name: 'payments', entry: 'src/transaction/payments.ts' }] },
  ...extra,
});

const zipOf = (files: Record<string, string>) =>
  writeZip(Object.entries(files).map(([path, content]) => ({ path, content: Buffer.from(content) })));

const validFiles = {
  'package.json': pkgJson(),
  'src/transaction/payments.ts': 'export const actionMap = new Map();\n',
  'src/lib/format.ts': 'export const fmt = (n: number) => n.toFixed(2);\n',
};

function hasCommand(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('zip', () => {
  it('reads back what it writes, deflating only when that is smaller', () => {
    const big = 'x'.repeat(10_000);
    const entries = readZip(zipOf({ 'a.txt': big, 'b.bin': 'ab' }));
    expect(entries.map((e) => [e.path, e.read().toString()])).toEqual([['a.txt', big], ['b.bin', 'ab']]);
    expect(entries[0].compressedSize).toBeLessThan(entries[0].uncompressedSize);
    expect(entries[1].compressedSize).toBe(entries[1].uncompressedSize);
  });

  it('writes the same bytes for the same files, in any order', () => {
    const a = writeZip([{ path: 'b', content: Buffer.from('2') }, { path: 'a', content: Buffer.from('1') }]);
    const b = writeZip([{ path: 'a', content: Buffer.from('1') }, { path: 'b', content: Buffer.from('2') }]);
    expect(a.equals(b)).toBe(true);
  });

  it('rejects something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just text that is long enough'))).toThrow(ZipFormatError);
  });

  (hasCommand('unzip') ? it : it.skip)('writes archives the system unzip accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-write-'));
    writeFileSync(join(dir, 'out.zip'), zipOf(validFiles));
    const out = execFileSync('unzip', ['-t', join(dir, 'out.zip')]).toString();
    expect(out).toContain('No errors detected');
  });

  (hasCommand('zip') ? it : it.skip)('reads archives the system zip writes, including a symlink entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-read-'));
    mkdirSync(join(dir, 'proj/src'), { recursive: true });
    writeFileSync(join(dir, 'proj/package.json'), pkgJson());
    writeFileSync(join(dir, 'proj/src/a.ts'), 'export const a = 1;\n'.repeat(50));
    symlinkSync('/etc/passwd', join(dir, 'proj/src/link'));
    execFileSync('zip', ['-r', '-y', '-q', join(dir, 'p.zip'), 'proj'], { cwd: dir });
    const entries = readZip(readFileSync(join(dir, 'p.zip')));
    expect(entries.find((e) => e.path === 'proj/src/a.ts')?.read().toString()).toBe('export const a = 1;\n'.repeat(50));
    expect(entries.find((e) => e.path === 'proj/src/link')?.isSymlink).toBe(true);
    expect(entries.find((e) => e.path === 'proj/')?.isDirectory).toBe(true);
  });
});

describe('normalizeSnippetPackage', () => {
  it('leaves out node_modules, .git, __MACOSX and .DS_Store, counting what it removed', () => {
    const { files, changes } = normalizeSnippetPackage(readZip(zipOf({
      ...validFiles,
      'node_modules/zod/index.js': 'x',
      'node_modules/zod/package.json': '{}',
      'src/node_modules/x.js': 'x',
      '.git/HEAD': 'ref',
      '__MACOSX/._package.json': 'x',
      'src/.DS_Store': 'x',
    })));
    expect(files.map((f) => f.path).sort()).toEqual(Object.keys(validFiles).sort());
    expect(changes).toEqual(['removed node_modules/ (3 entries)', 'removed .git/ (1 entry)', 'removed __MACOSX/ (1 entry)', 'removed .DS_Store (1 entry)']);
  });

  it('moves the package root up when everything is in one top-level directory', () => {
    const { files, changes } = normalizeSnippetPackage(readZip(zipOf(
      Object.fromEntries(Object.entries(validFiles).map(([p, c]) => [`acme-handlers/${p}`, c])),
    )));
    expect(files.map((f) => f.path).sort()).toEqual(Object.keys(validFiles).sort());
    expect(changes).toEqual(['moved the package root up from acme-handlers/']);
  });

  it('changes nothing in a package that is already clean', () => {
    expect(normalizeSnippetPackage(readZip(zipOf(validFiles))).changes).toEqual([]);
  });
});

describe('checkSnippetPackage', () => {
  const check = (files: Record<string, string>) => inspectSnippetPackage(zipOf(files)).problems;

  it('accepts a package that depends only on Kaleido SDKs, with any devDependencies', () => {
    const result = inspectSnippetPackage(zipOf(validFiles));
    expect(result.problems).toEqual([]);
    expect(result.packageJson?.kaleido?.transactionHandlers).toEqual([{ name: 'payments', entry: 'src/transaction/payments.ts' }]);
  });

  it('rejects dependencies the TypeScript provider does not supply', () => {
    expect(check({ ...validFiles, 'package.json': pkgJson({ dependencies: { lodash: '^4.17.21' }, peerDependencies: { axios: '*' } }) })).toEqual([
      expect.stringContaining('package.json dependencies names "lodash"'),
      expect.stringContaining('package.json peerDependencies names "axios"'),
    ]);
  });

  it('accepts zod, which the TypeScript provider supplies alongside the Kaleido SDKs', () => {
    expect(check({ ...validFiles, 'package.json': pkgJson({ dependencies: { '@kaleido-io/workflow-engine-sdk': '^1.1.0', zod: '^4.6.0' } }) })).toEqual([]);
    expect(isSuppliedDependency('zod')).toBe(true);
    expect(isSuppliedDependency('@kaleido-io/core-sdk')).toBe(true);
    expect(isSuppliedDependency('zod-extra')).toBe(false);
  });

  it('accepts ethers, which the TypeScript provider supplies alongside the Kaleido SDKs', () => {
    expect(check({ ...validFiles, 'package.json': pkgJson({ dependencies: { '@kaleido-io/workflow-engine-sdk': '^1.1.0', ethers: '^6.17.0' } }) })).toEqual([]);
    expect(isSuppliedDependency('ethers')).toBe(true);
    expect(isSuppliedDependency('@ethersproject/abi')).toBe(false);
    expect(isSuppliedDependency('@noble/hashes')).toBe(false);
  });

  it('needs a package.json at the root, and a valid one', () => {
    expect(check({ 'src/a.ts': 'x', 'other/b.ts': 'y' })).toEqual(['the package has no package.json at its root']);
    expect(check({ 'package.json': '[1]' })).toEqual([expect.stringContaining('package.json is not a valid JSON object')]);
    expect(check({ 'package.json': '{' })).toEqual([expect.stringContaining('package.json is not a valid JSON object')]);
  });

  it('rejects unsafe paths', () => {
    expect(check({ ...validFiles, '../evil.ts': 'x', '/abs.ts': 'x', 'src\\win.ts': 'x' })).toEqual(expect.arrayContaining([
      '../evil.ts contains a .. segment',
      '/abs.ts is an absolute path',
      'src\\win.ts contains a backslash',
    ]));
  });

  it('checks the kaleido manifest', () => {
    expect(check({ ...validFiles, 'package.json': pkgJson({ kaleido: {
      transactionHandlers: [{ name: 'a', entry: 'src/missing.ts' }, { name: 'a', entry: 'src/lib/format.ts' }, { entry: 'src/lib/format.ts' }],
      eventSources: 'nope',
    } }) })).toEqual([
      'package.json kaleido.transactionHandlers[0]: entry "src/missing.ts" is not in the package',
      'package.json kaleido.transactionHandlers[1]: handler name "a" is used more than once',
      'package.json kaleido.transactionHandlers[2] needs a "name"',
      'package.json kaleido.eventSources must be an array',
    ]);
  });

  it('caps the number of files', () => {
    const files: Record<string, string> = { 'package.json': pkgJson({ kaleido: undefined }) };
    for (let i = 0; i < MAX_PACKAGE_ENTRIES; i++) files[`src/f${i}.ts`] = '';
    expect(check(files)).toEqual([`the package has ${MAX_PACKAGE_ENTRIES + 1} files; the most allowed is ${MAX_PACKAGE_ENTRIES}`]);
  });

  it('reports an empty package', () => {
    expect(checkSnippetPackage([]).problems).toEqual(['the package is empty']);
  });
});

describe('extractSnippetPackage', () => {
  it('writes the normalised files under the directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-'));
    const zip = zipOf({ ...Object.fromEntries(Object.entries(validFiles).map(([p, c]) => [`top/${p}`, c])), 'top/node_modules/x/index.js': 'x' });
    const { changes } = extractSnippetPackage(zip, dir);
    expect(changes).toEqual(['removed node_modules/ (1 entry)', 'moved the package root up from top/']);
    expect(readFileSync(join(dir, 'src/lib/format.ts'), 'utf8')).toBe(validFiles['src/lib/format.ts']);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
  });

  it('refuses an invalid package, listing every problem, and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-bad-'));
    const zip = zipOf({ ...validFiles, '../escape.ts': 'x', 'package.json': pkgJson({ dependencies: { lodash: '1' } }) });
    expect(() => extractSnippetPackage(zip, dir)).toThrow(SnippetPackageError);
    try {
      extractSnippetPackage(zip, dir);
    } catch (error) {
      expect((error as SnippetPackageError).problems).toHaveLength(2);
    }
    expect(existsSync(join(dir, 'package.json'))).toBe(false);
  });
});

describe('packSnippetPackage', () => {
  it('zips the project, leaving out node_modules, build output, lockfiles, ignored files and earlier zips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    for (const [p, c] of Object.entries({
      ...validFiles,
      'test/payments.test.ts': 'test',
      'node_modules/@kaleido-io/workflow-engine-sdk/package.json': '{}',
      'dist/index.js': 'built',
      'coverage/lcov.info': 'x',
      'logs/run.log': 'x',
      'acme-handlers-1.0.0.zip': 'old',
      'package-lock.json': '{}',
      '.gitignore': 'logs/\n*.log\n',
    })) {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    const { zip, files } = packSnippetPackage(dir);
    expect(files).toEqual(['.gitignore', 'package.json', 'src/lib/format.ts', 'src/transaction/payments.ts', 'test/payments.test.ts']);
    expect(inspectSnippetPackage(zip).problems).toEqual([]);
  });

  const write = (dir: string, files: Record<string, string>) => {
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  };

  it('leaves out files a .gitignore names by path, as well as by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-paths-'));
    write(dir, {
      ...validFiles,
      'config/local-bindings.yaml': 'password: not-for-the-zip',
      'config/provider-config.yaml': 'book: primary',
      'build/out.js': 'built',
      'src/fixtures/secret.txt': 'x',
      'src/build/keep.ts': 'kept: only the top-level build is ignored',
      '.gitignore': 'config/local-bindings.yaml\n/build/\n**/secret.txt\n',
    });
    const { files } = packSnippetPackage(dir);
    expect(files).toEqual([
      '.gitignore',
      'config/provider-config.yaml',
      'package.json',
      'src/build/keep.ts',
      'src/lib/format.ts',
      'src/transaction/payments.ts',
    ]);
  });

  it("leaves out files that only a parent repository's .gitignore names", () => {
    const repo = mkdtempSync(join(tmpdir(), 'pack-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const dir = join(repo, 'handlers');
    write(repo, { '.gitignore': 'handlers/config/local-bindings.yaml\n*.log\n' });
    write(dir, {
      ...validFiles,
      'config/local-bindings.yaml': 'password: not-for-the-zip',
      'config/provider-config.yaml': 'book: primary',
      'run.log': 'x',
    });
    const { files } = packSnippetPackage(dir);
    expect(files).toEqual(['config/provider-config.yaml', 'package.json', 'src/lib/format.ts', 'src/transaction/payments.ts']);
  });
});

describe('packSnippetPackage handler list', () => {
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-handlers-'));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    return dir;
  };
  const zippedPackageJson = (zip: Buffer) =>
    JSON.parse(readZip(zip).find((e) => e.path === 'package.json')!.read().toString('utf8'));
  const sourcePackageJson = JSON.stringify({ name: 'acme-handlers', version: '1.0.0', dependencies: { '@kaleido-io/workflow-engine-sdk': '^1.1.0' } }, null, 2);
  const handlerFiles = {
    'src/transaction/payments.ts': "export const paymentHandler = defineTransactionHandler('payments', {});\n",
    'src/processor/audit.ts': 'export const auditProcessor = defineProcessor(async () => {});\n',
  };

  it('lists the handlers found in the code in the zip, leaving the project\'s package.json as it is', () => {
    const dir = project({ 'package.json': sourcePackageJson, ...handlerFiles });
    const packed = packSnippetPackage(dir, { typescript });
    expect(packed.handlerSource).toBe('code');
    expect(packed.problems).toEqual([]);
    expect(packed.handlers).toEqual({
      eventProcessors: [{ name: 'audit', entry: 'src/processor/audit.ts' }],
      transactionHandlers: [{ name: 'payments', entry: 'src/transaction/payments.ts' }],
    });
    expect(zippedPackageJson(packed.zip).kaleido).toEqual(packed.handlers);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(sourcePackageJson);
    expect(inspectSnippetPackage(packed.zip).problems).toEqual([]);
  });

  it('records the conventional config file as the package default', () => {
    const dir = project({ 'package.json': sourcePackageJson, ...handlerFiles, 'config/provider-config.yaml': 'book: primary\n' });
    const packed = packSnippetPackage(dir, { typescript });
    expect(packed.problems).toEqual([]);
    expect(packed.handlers.config).toBe('config/provider-config.yaml');
    expect(zippedPackageJson(packed.zip).kaleido.config).toBe('config/provider-config.yaml');
  });

  it('takes the default from the option, and each handler\'s own config from handlerConfig, still finding the handlers in the code', () => {
    const kaleido = { config: 'config/shared.yaml', handlerConfig: { audit: './config/audit.yaml' } };
    const dir = project({
      'package.json': JSON.stringify({ ...JSON.parse(sourcePackageJson), kaleido }),
      ...handlerFiles,
      'config/shared.yaml': 'a: 1\n',
      'config/other.yaml': 'a: 2\n',
      'config/audit.yaml': 'a: 3\n',
    });
    expect(packSnippetPackage(dir, { typescript }).handlers.config).toBe('config/shared.yaml');
    const packed = packSnippetPackage(dir, { typescript, config: 'config/other.yaml' });
    expect(packed.handlerSource).toBe('code');
    expect(packed.problems).toEqual([]);
    expect(packed.handlers).toEqual({
      config: 'config/other.yaml',
      eventProcessors: [{ name: 'audit', entry: 'src/processor/audit.ts', config: 'config/audit.yaml' }],
      transactionHandlers: [{ name: 'payments', entry: 'src/transaction/payments.ts' }],
    });
    expect(zippedPackageJson(packed.zip).kaleido).toEqual(packed.handlers);
  });

  it('refuses a config file that is missing or left out, and handlerConfig for a handler the package has not got', () => {
    const kaleido = { config: 'config/missing.yaml', handlerConfig: { payments: 'config/local-bindings.yaml', nobody: 'config/x.yaml' } };
    const dir = project({
      'package.json': JSON.stringify({ ...JSON.parse(sourcePackageJson), kaleido }),
      ...handlerFiles,
      '.gitignore': 'config/local-bindings.yaml\n',
      'config/local-bindings.yaml': 'password: not-for-the-zip\n',
      'config/x.yaml': 'x: 1\n',
    });
    const packed = packSnippetPackage(dir, { typescript });
    expect(packed.problems).toEqual([
      'package.json "kaleido.handlerConfig" names "nobody", which isn\'t one of the package\'s handlers',
      "Config file config/missing.yaml isn't in the package: it doesn't exist, or .gitignore leaves it out",
      "Config file config/local-bindings.yaml isn't in the package: it doesn't exist, or .gitignore leaves it out",
    ]);
    expect(packed.files).not.toContain('config/local-bindings.yaml');
  });

  it('moves the secrets each handler reads onto its entry, and refuses bad names or unknown handlers', () => {
    const good = project({
      'package.json': JSON.stringify({ ...JSON.parse(sourcePackageJson), kaleido: { handlerSecrets: { payments: ['coreBankingApiKey', 'coreBankingApiKey'] } } }),
      ...handlerFiles,
    });
    const packed = packSnippetPackage(good, { typescript });
    expect(packed.problems).toEqual([]);
    expect(packed.handlers.transactionHandlers).toEqual([
      { name: 'payments', entry: 'src/transaction/payments.ts', secrets: ['coreBankingApiKey'] },
    ]);
    expect(zippedPackageJson(packed.zip).kaleido.handlerSecrets).toBeUndefined();

    const bad = project({
      'package.json': JSON.stringify({ ...JSON.parse(sourcePackageJson), kaleido: { handlerSecrets: { payments: ['../key'], nobody: ['x'] } } }),
      ...handlerFiles,
    });
    expect(packSnippetPackage(bad, { typescript }).problems).toEqual([
      'package.json "kaleido.handlerSecrets" names "nobody", which isn\'t one of the package\'s handlers',
      'Handler "payments": secret name "../key" must start with a letter or digit and contain only letters, digits, ".", "_" and "-"',
    ]);
  });

  it('uses a "kaleido" section as it is, warning about handlers in the code that it leaves out', () => {
    const kaleido = { transactionHandlers: [{ name: 'pay', entry: 'src/transaction/payments.ts' }] };
    const dir = project({ 'package.json': JSON.stringify({ ...JSON.parse(sourcePackageJson), kaleido }), ...handlerFiles });
    const packed = packSnippetPackage(dir, { typescript });
    expect(packed.handlerSource).toBe('package.json');
    expect(packed.handlers).toEqual(kaleido);
    expect(zippedPackageJson(packed.zip).kaleido).toEqual(kaleido);
    expect(packed.warnings).toEqual([
      'src/processor/audit.ts defines handler "audit", which the package.json "kaleido" section doesn\'t list, so it won\'t be offered',
    ]);
  });

  it('reports handlers it cannot list, and leaves the zip\'s package.json without a section', () => {
    const dir = project({
      'package.json': sourcePackageJson,
      'src/a.ts': "export const a = defineTransactionHandler('same', {});\n",
      'src/b.ts': "export const b = defineProcessor('same', async () => {});\n",
    });
    const packed = packSnippetPackage(dir, { typescript });
    expect(packed.problems).toEqual(['src/a.ts and src/b.ts both define a handler named "same"; handler names must be unique in a package']);
    expect(zippedPackageJson(packed.zip).kaleido).toBeUndefined();
  });
});
