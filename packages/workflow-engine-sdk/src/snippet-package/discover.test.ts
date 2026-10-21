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
import * as typescript from 'typescript';

import { discoverHandlers, isHandlerSourceFile, manifestFromHandlers } from './discover';

const sources = {
  'src/transaction/payments.ts': `import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';
export const paymentHandler = defineTransactionHandler('payments', { pay: async () => ({}) });
`,
  'src/transaction/hello.ts': `import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';
// defineTransactionHandler('not-this', {}) in a comment is ignored
export const helloHandler = defineTransactionHandler({ hello: async () => ({}) });
`,
  'src/eventsource/feed.ts': `import { defineEventSource } from '@kaleido-io/workflow-engine-sdk';
export const feed = defineEventSource<{ n: number }, unknown, { v: number }>('ledger-feed', {
  poll: async () => ({ checkpoint: { n: 1 } }),
});
`,
  'src/processor/writer.ts': `import { defineProcessor } from '@kaleido-io/workflow-engine-sdk';
export const writer = defineProcessor("ledger-writer", async () => {});
`,
  'src/lib/money.ts': 'export const fee = (n: number) => n * 0.01;\n',
  'test/payments.test.ts': `export const x = defineTransactionHandler('in-a-test', {});\n`,
  'src/processor/writer.spec.ts': `export const y = defineProcessor('in-a-spec', async () => {});\n`,
};

const expected = [
  { kind: 'eventSources', name: 'ledger-feed', entry: 'src/eventsource/feed.ts', named: true },
  { kind: 'eventProcessors', name: 'ledger-writer', entry: 'src/processor/writer.ts', named: true },
  { kind: 'transactionHandlers', name: 'hello', entry: 'src/transaction/hello.ts', named: false },
  { kind: 'transactionHandlers', name: 'payments', entry: 'src/transaction/payments.ts', named: true },
];

describe.each([
  ['with the TypeScript compiler', { typescript }],
  ['without the TypeScript compiler', {}],
])('discoverHandlers %s', (_label, options) => {
  it('finds one handler per file, named in the code or after the file, leaving out tests and other files', () => {
    expect(discoverHandlers(sources, options)).toEqual({ handlers: expected, problems: [] });
  });

  it('reports two handlers in one file', () => {
    const { problems } = discoverHandlers({
      'src/two.ts': `export const a = defineTransactionHandler('a', {});\nexport const b = defineProcessor('b', async () => {});\n`,
    }, options);
    expect(problems).toEqual([expect.stringContaining('src/two.ts exports 2 handlers (defineTransactionHandler, defineProcessor)')]);
  });

  it('reports two handlers with the same name, naming both files', () => {
    const { problems } = discoverHandlers({
      'src/a.ts': `export const a = defineTransactionHandler('dup', {});\n`,
      'src/b.ts': `export const b = defineEventSource('dup', { poll: () => ({ checkpoint: 0 }) });\n`,
    }, options);
    expect(problems).toEqual(['src/a.ts and src/b.ts both define a handler named "dup"; handler names must be unique in a package']);
  });

  it('asks for a string literal when the name is in a variable', () => {
    const { handlers, problems } = discoverHandlers({
      'src/a.ts': `const NAME = 'x';\nexport const a = defineTransactionHandler(NAME, {});\n`,
      'src/b.ts': `const NAME = 'y';\nexport const b = defineEventSource(NAME, { poll: () => ({ checkpoint: 0 }) });\n`,
    }, options);
    expect(handlers).toEqual([]);
    expect(problems).toEqual([
      "src/a.ts: give defineTransactionHandler its handler name as a string literal, such as defineTransactionHandler('a', …), so it can be read without running the code",
      "src/b.ts: give defineEventSource its handler name as a string literal, such as defineEventSource('b', …), so it can be read without running the code",
    ]);
  });
});

describe('discoverHandlers with the TypeScript compiler', () => {
  it('follows a local definition exported later, a default export and a renamed export', () => {
    const { handlers, problems } = discoverHandlers({
      'src/later.ts': `const h = defineTransactionHandler('later', {});\nexport { h };\n`,
      'src/default.ts': `export default defineProcessor('by-default', async () => {});\n`,
      'src/renamed.ts': `const s = defineEventSource('renamed', { poll: () => ({ checkpoint: 0 }) });\nexport { s as source };\n`,
      'src/local-only.ts': `const notExported = defineTransactionHandler('hidden', {});\nvoid notExported;\n`,
    }, { typescript });
    expect(problems).toEqual([]);
    expect(handlers.map((h) => [h.entry, h.name])).toEqual([
      ['src/default.ts', 'by-default'],
      ['src/later.ts', 'later'],
      ['src/renamed.ts', 'renamed'],
    ]);
  });
});

describe('discoverHandlers without the TypeScript compiler', () => {
  it('reports a definition it cannot follow rather than guessing', () => {
    const { handlers, problems } = discoverHandlers({ 'src/later.ts': `const h = defineTransactionHandler('later', {});\nexport { h };\n` });
    expect(handlers).toEqual([]);
    expect(problems).toEqual([expect.stringContaining("src/later.ts defines a handler in a form that can't be read without the TypeScript compiler")]);
  });
});

describe('isHandlerSourceFile', () => {
  it('takes TypeScript source outside tests and build output', () => {
    expect(['src/a.ts', 'src/a.mts', 'lib/x.cts'].every(isHandlerSourceFile)).toBe(true);
    expect(['src/a.test.ts', 'src/a.spec.ts', 'test/a.ts', 'tests/a.ts', 'src/__tests__/a.ts', 'dist/a.ts', 'src/a.d.ts', 'src/a.js', 'README.md']
      .some(isHandlerSourceFile)).toBe(false);
  });
});

describe('manifestFromHandlers', () => {
  it('lists the handlers by kind, as the package.json "kaleido" section does', () => {
    expect(manifestFromHandlers(discoverHandlers(sources, { typescript }).handlers)).toEqual({
      eventSources: [{ name: 'ledger-feed', entry: 'src/eventsource/feed.ts' }],
      eventProcessors: [{ name: 'ledger-writer', entry: 'src/processor/writer.ts' }],
      transactionHandlers: [
        { name: 'hello', entry: 'src/transaction/hello.ts' },
        { name: 'payments', entry: 'src/transaction/payments.ts' },
      ],
    });
  });
});
