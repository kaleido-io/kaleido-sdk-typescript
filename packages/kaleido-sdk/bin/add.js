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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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
  name    The handler name workflows and streams bind to (lowercase letters, numbers and hyphens)

Writes a starter handler under src/ and a test under test/, and adds the
handler to the "kaleido" section of package.json.

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
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('the name must be lowercase letters, numbers and hyphens');

const pkgPath = join(process.cwd(), 'package.json');
if (!existsSync(pkgPath)) fail('no package.json in the current directory. Run this in a snippet package project.');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.kaleido ??= {};
const taken = Object.values(KINDS).flatMap(({ section }) => (pkg.kaleido[section] ?? []).map((h) => h.name));
if (taken.includes(name)) fail(`a handler named "${name}" is already in package.json`);

const entry = `${spec.dir}/${name}.ts`;
const testFile = `test/${name}.test.ts`;
for (const file of [entry, testFile]) {
  if (existsSync(join(process.cwd(), file))) fail(`${file} already exists`);
}

const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const fromTest = `../${entry.replace(/\.ts$/, '.js')}`;

const sources = {
  'transaction-handler': [`import { defineTransactionHandler } from '@kaleido-io/workflow-engine-sdk';

// Each key is an action: the stage selects it with "action" in its inputMap.
export const actionMap = defineTransactionHandler({
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
import { actionMap } from '${fromTest}';

describe('${name}', () => {
  it('returns the value', async () => {
    const result = await invokeAction(actionMap, '${name}', { value: 'x' });
    expect(result.result).toBe(EvalResult.COMPLETE);
    expect(result.output).toEqual({ value: 'x' });
  });
});
`],
  'event-source': [`import { createEventSource } from '@kaleido-io/workflow-engine-sdk';

interface ${camel[0].toUpperCase() + camel.slice(1)}Checkpoint {
  position: number;
}

// Called on every poll with the stream's config and the checkpoint from the last poll.
export const eventSource = createEventSource<${camel[0].toUpperCase() + camel.slice(1)}Checkpoint, Record<string, unknown>, { position: number }>(
  '${name}',
  async (conf, checkpoint) => {
    const position = (checkpoint?.position ?? 0) + 1;
    return {
      checkpointOut: { position },
      events: [{ idempotencyKey: \`\${conf.streamId}-\${position}\`, topic: '${name}', data: { position } }],
    };
  },
);
`, `import { describe, expect, it } from 'vitest';
import { WSMessageType, type WSListenerPollResult } from '@kaleido-io/workflow-engine-sdk';
import { eventSource } from '${fromTest}';

describe('${name}', () => {
  it('emits the next position', async () => {
    const result: WSListenerPollResult = { messageType: WSMessageType.EVENT_SOURCE_POLL_RESULT, id: 'p', events: [] };
    await eventSource.eventSourcePoll(
      { requestId: 'p', signal: new AbortController().signal, cancel: () => {} },
      { messageType: WSMessageType.EVENT_SOURCE_CONFIG, id: 'c', streamId: 's1', streamName: 'stream', config: {} },
      result,
      { messageType: WSMessageType.EVENT_SOURCE_POLL, id: 'p', streamId: 's1', streamName: 'stream', checkpoint: { position: 1 } },
    );
    expect(result.events).toEqual([{ idempotencyKey: 's1-2', topic: '${name}', data: { position: 2 } }]);
  });
});
`],
  'event-processor': [`import { defineProcessor } from '@kaleido-io/workflow-engine-sdk';

// Called with each batch of events the stream delivers. Throwing fails the batch, and the engine redelivers it.
export const processBatch = defineProcessor(async (events) => {
  for (const event of events) {
    void event;
  }
});
`, `import { describe, expect, it } from 'vitest';
import { processBatch } from '${fromTest}';

describe('${name}', () => {
  it('handles a batch', async () => {
    await expect(processBatch({} as never, [{ idempotencyKey: 'k1', topic: 't', data: {} }])).resolves.toBeUndefined();
  });
});
`],
};

const [source, test] = sources[kind];
for (const [file, content] of [[entry, source], [testFile, test]]) {
  mkdirSync(dirname(join(process.cwd(), file)), { recursive: true });
  writeFileSync(join(process.cwd(), file), content);
}
(pkg.kaleido[spec.section] ??= []).push({ name, entry });
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Added ${kind} "${name}":`);
console.log(`  ${entry}`);
console.log(`  ${testFile}`);
console.log(`  package.json kaleido.${spec.section}`);
