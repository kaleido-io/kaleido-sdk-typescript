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

import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadHandlersConfig } from './handlers-config';
import { handlerPathCandidates, extractActionMap, importHandlerModule, isMountedHandlerPath, resolveImportPath } from './register-handlers';

describe('handlers-config', () => {
  it('loads handlers from yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handlers-config-'));
    const configPath = join(dir, 'provider-config.yaml');
    writeFileSync(
      configPath,
      `handlers:
  - name: hello
    file: handlers/hello.ts
`,
    );

    expect(loadHandlersConfig(configPath)).toEqual({
      handlers: [{ name: 'hello', file: 'handlers/hello.ts' }],
    });
  });

  it('allows an empty handlers array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handlers-config-'));
    const configPath = join(dir, 'provider-config.yaml');
    writeFileSync(configPath, 'handlers: []\n');

    expect(loadHandlersConfig(configPath)).toEqual({ handlers: [] });
  });

  it('rejects duplicate handler names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handlers-config-'));
    const configPath = join(dir, 'provider-config.yaml');
    writeFileSync(
      configPath,
      `handlers:
  - name: hello
    file: handlers/hello.ts
  - name: hello
    file: handlers/other.ts
`,
    );

    expect(() => loadHandlersConfig(configPath)).toThrow(/Duplicate handler names/);
  });
});

describe('register-handlers', () => {
  it('imports a handler module actionMap', async () => {
    const { actionMap } = await importHandlerModule(process.cwd(), {
      name: 'hello',
      file: 'handlers/hello.ts',
    });

    expect(actionMap.get('hello')).toBeDefined();
  });

  it('resolves absolute handler paths from config', () => {
    const originalArgv = process.argv[1];
    process.argv[1] = '/app/dist/connect.js';

    try {
      const candidates = handlerPathCandidates('/config/provider-config.yaml', '/mnt/snippets/hello.ts');
      expect(candidates[0]).toBe('/mnt/snippets/hello.ts');
      expect(candidates).toContain('/mnt/snippets/hello.js');
    } finally {
      process.argv[1] = originalArgv;
    }
  });

  it('falls back to compiled dist for relative handler paths', () => {
    const originalArgv = process.argv[1];

    try {
      process.argv[1] = '/app/connect.ts';
      const devCandidates = handlerPathCandidates(process.cwd(), 'handlers/hello.ts');
      expect(devCandidates[0]).toBe(join(process.cwd(), 'handlers', 'hello.ts'));

      process.argv[1] = '/app/dist/connect.js';
      const compiled = handlerPathCandidates(process.cwd(), 'handlers/hello.ts');
      expect(compiled[0]).toBe(join(process.cwd(), 'handlers', 'hello.ts'));
      expect(compiled).toContain(join(process.cwd(), 'handlers', 'hello.js'));
      expect(compiled).toContain(join(process.cwd(), 'dist', 'handlers', 'hello.js'));
    } finally {
      process.argv[1] = originalArgv;
    }
  });

  it('resolveImportPath finds built-in hello handler', () => {
    const path = resolveImportPath(process.cwd(), 'handlers/hello.ts');
    expect(path).toMatch(/handlers\/hello\.(ts|js)$/);
  });

  it('extractActionMap accepts a named Map export', () => {
    const actionMap = new Map([['hello', { handler: async () => ({}) }]]);
    const result = extractActionMap({ actionMap }, 'hello', '/snippets/hello.ts', '/snippets/hello.ts');
    expect(result).toBe(actionMap);
  });

  it('extractActionMap accepts a plain object actionMap', () => {
    const result = extractActionMap(
      { actionMap: { hello: { handler: async () => ({}) } } },
      'hello',
      '/snippets/hello.ts',
      '/snippets/hello.ts',
    );
    expect(result.get('hello')).toBeDefined();
  });

  it('extractActionMap accepts default export with actionMap', () => {
    const actionMap = new Map([['hello', { handler: async () => ({}) }]]);
    const result = extractActionMap(
      { default: { actionMap } },
      'hello',
      '/snippets/hello.ts',
      '/snippets/hello.ts',
    );
    expect(result).toBe(actionMap);
  });

  it('isMountedHandlerPath detects platform-mounted snippets', () => {
    expect(isMountedHandlerPath('/snippets/hello.ts')).toBe(true);
    expect(isMountedHandlerPath(join(process.cwd(), 'handlers', 'hello.ts'))).toBe(false);
  });

  it('bundles platform-mounted handlers outside the provider cwd', async () => {
    const mountDir = mkdtempSync(join(tmpdir(), 'mounted-handler-'));
    const handlerPath = join(mountDir, 'hello.ts');
    copyFileSync(join(process.cwd(), 'handlers', 'hello.ts'), handlerPath);

    const { actionMap } = await importHandlerModule(process.cwd(), {
      name: 'hello',
      file: handlerPath,
    });

    expect(actionMap.get('hello')).toBeDefined();
  });
});
