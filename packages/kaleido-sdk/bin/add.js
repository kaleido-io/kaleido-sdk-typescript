#!/usr/bin/env node
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

// ksdk add: add a handler to a TypeScript provider snippet package.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, relative, sep } from 'path';
import { discoverHandlers, isHandlerSourceFile } from '@kaleido-io/workflow-engine-sdk/snippet-package';

const KINDS = {
  'transaction-handler': { section: 'transactionHandlers', dir: 'src/transaction' },
  'event-source': { section: 'eventSources', dir: 'src/eventsource' },
  'event-processor': { section: 'eventProcessors', dir: 'src/processor' },
};

const args = process.argv.slice(2);
const [kind, name] = args;

if (!kind || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx ksdk add <kind> <name>

  kind    ${Object.keys(KINDS).join(' | ')}
  name    The handler name workflows and streams bind to (letters, numbers, '.', '_' and '-')

Writes a starter handler under src/, named in its code, and a test under test/.
If package.json has a "kaleido" section, the handler is added to it too.

Examples:
  npx ksdk add transaction-handler payments
  npx ksdk add event-source ledger-feed
  npx ksdk add event-processor ledger-writer
`);
  process.exit(kind ? 0 : 1);
}

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

const spec = KINDS[kind];
if (!spec) fail(`unknown kind "${kind}". Use one of: ${Object.keys(KINDS).join(', ')}`);
// The workflow engine's rule for the handler names that workflows and streams bind to
if (!name || !/^[0-9a-zA-Z]([0-9a-zA-Z._-]{0,62}[0-9a-zA-Z])?$/.test(name)) {
  fail("the name must be 1 to 64 letters, numbers, '.', '_' or '-', starting and ending with a letter or number");
}

const pkgPath = join(process.cwd(), 'package.json');
if (!existsSync(pkgPath)) fail('no package.json in the current directory. Run this in a snippet package project.');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
// The names already taken: the handlers found in the code, and any listed in package.json.
const projectSources = {};
const walk = (dir) => {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    const rel = relative(process.cwd(), full).split(sep).join('/');
    if (dirent.isDirectory() && !['node_modules', '.git', 'dist', 'coverage'].includes(dirent.name)) walk(full);
    else if (dirent.isFile() && isHandlerSourceFile(rel)) projectSources[rel] = readFileSync(full, 'utf8');
  }
};
walk(process.cwd());
let typescript;
try {
  typescript = createRequire(pkgPath)('typescript');
} catch {
  typescript = undefined;
}
const inCode = discoverHandlers(projectSources, { typescript }).handlers;
const listed = pkg.kaleido ? Object.values(KINDS).flatMap(({ section }) => (pkg.kaleido[section] ?? []).map((h) => ({ name: h.name, entry: h.entry }))) : [];
const clash = [...inCode, ...listed].find((h) => h.name === name);
if (clash) fail(`a handler named "${name}" is already defined, in ${clash.entry}`);

const entry = `${spec.dir}/${name}.ts`;
const testFile = `test/${name}.test.ts`;
for (const file of [entry, testFile]) {
  if (existsSync(join(process.cwd(), file))) fail(`${file} already exists`);
}

// A JavaScript identifier from the name: each '-', '.' or '_' joins the next word in camel case
const words = name.split(/[-._]+/).filter(Boolean);
const joined = words.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');
const camel = /^[0-9]/.test(joined) ? `handler${joined}` : joined;
const fromTest = `../${entry.replace(/\.ts$/, '.js')}`;

const Camel = camel[0].toUpperCase() + camel.slice(1);
// Any export name works: the provider loads the one define* export a file has
const exportName = { 'transaction-handler': `${camel}Handler`, 'event-source': `${camel}Source`, 'event-processor': `${camel}Processor` }[kind];

const sources = {
  'transaction-handler': [`import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

// Each key is an action: the stage selects it with "action" in its inputMap.
export const ${exportName} = defineTransactionHandler('${name}', {
  '${name}': async (input: { value?: string }) => {
    if (!input.value) {
      throw new Error('value is required');
    }
    return { value: input.value };
  },
});
`, `import { describe, expect, it } from 'vitest';
import { EvalResult } from '@kaleido-io/workflow-engine-sdk';
import { invokeAction } from '@kaleido-io/workflow-engine-sdk/testing';
import { ${exportName} } from '${fromTest}';

describe('${name}', () => {
  it('returns the value', async () => {
    const result = await invokeAction(${exportName}, '${name}', { value: 'x' });
    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ value: 'x' });
  });
});
`],
  'event-source': [`import { defineEventSource } from '@kaleido-io/workflow-engine-sdk';

interface ${Camel}Record {
  position: number;
}

interface ${Camel}Checkpoint {
  position: number;
}

// Replace this with a call to the system the source watches: return the records after \`position\`, oldest first.
// Return none when nothing is new, so the engine waits before polling again.
async function fetchRecordsAfter(position: number): Promise<${Camel}Record[]> {
  void position;
  return [];
}

// Polled repeatedly for each stream that uses this source, with the checkpoint the last poll returned.
export const ${exportName} = defineEventSource<${Camel}Checkpoint, Record<string, unknown>, ${Camel}Record>('${name}', {
  poll: async ({ checkpoint, stream }) => {
    const after = checkpoint?.position ?? 0;
    const records = await fetchRecordsAfter(after);
    return {
      checkpoint: { position: records.at(-1)?.position ?? after },
      // The stream ID keeps events from two streams on this source apart.
      events: records.map((record) => ({ idempotencyKey: \`\${stream.streamId}-\${record.position}\`, topic: '${name}', data: record })),
    };
  },
});
`, `import { describe, expect, it } from 'vitest';
import { WSMessageType, type WSListenerPollResult } from '@kaleido-io/workflow-engine-sdk';
import { ${exportName} } from '${fromTest}';

describe('${name}', () => {
  it('emits nothing and keeps its place when there is nothing new', async () => {
    const result: WSListenerPollResult = { messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT, id: 'p', events: [] };
    await ${exportName}.eventSourcePoll(
      { requestId: 'p', signal: new AbortController().signal, cancel: () => {} },
      { messageType: WSMessageType.EVENT_SOURCE_CONFIG, id: 'c', streamId: 's1', streamName: 'stream', config: {} },
      result,
      { messageType: WSMessageType.EVENT_SOURCE_POLL, id: 'p', streamId: 's1', streamName: 'stream', checkpoint: { position: 4 } },
    );
    expect(result.events).toEqual([]);
    expect(result.checkpoint).toEqual({ position: 4 });
  });
});
`],
  'event-processor': [`import { defineProcessor } from '@kaleido-io/workflow-engine-sdk';

// Called with each batch of events the stream delivers. Throwing fails the batch, and the engine redelivers it.
export const ${exportName} = defineProcessor('${name}', async (events) => {
  for (const event of events) {
    void event;
  }
});
`, `import { describe, expect, it } from 'vitest';
import { ${exportName} } from '${fromTest}';

describe('${name}', () => {
  it('handles a batch', async () => {
    await expect(${exportName}({} as never, [{ idempotencyKey: 'k1', topic: 't', data: {} }])).resolves.toBeUndefined();
  });
});
`],
};

const [source, test] = sources[kind];
for (const [file, content] of [[entry, source], [testFile, test]]) {
  mkdirSync(dirname(join(process.cwd(), file)), { recursive: true });
  writeFileSync(join(process.cwd(), file), content);
}
// A "kaleido" section replaces the handlers found in the code, so it must list the new one too.
if (pkg.kaleido) {
  (pkg.kaleido[spec.section] ??= []).push({ name, entry });
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

console.log(`Added ${kind} "${name}":`);
console.log(`  ${entry}`);
console.log(`  ${testFile}`);
if (pkg.kaleido) console.log(`  package.json kaleido.${spec.section}`);
