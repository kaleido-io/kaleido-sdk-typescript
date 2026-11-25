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

// Loads every entry of every package by name with require(), as a CommonJS
// application does, and checks it returns the same objects as import(). Run
// it after building the packages. It fails if an entry can't be required,
// for example because the entry has no condition a require() matches, or
// because the module or one of its dependencies uses top-level await.

const { readdirSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');

const packagesDir = join(__dirname, '..', '..', 'packages');

async function main() {
  const failures = [];
  let checked = 0;
  for (const dir of readdirSync(packagesDir)) {
    const pkgFile = join(packagesDir, dir, 'package.json');
    if (!existsSync(pkgFile)) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    for (const subpath of Object.keys(pkg.exports ?? {})) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      try {
        const required = require(specifier);
        const imported = await import(specifier);
        const keys = Object.keys(imported);
        const differ = keys.filter((key) => required[key] !== imported[key]);
        if (keys.length === 0 || differ.length > 0) {
          failures.push(`${specifier}: require() and import() return different exports (${differ.join(', ') || 'none exported'})`);
        }
      } catch (error) {
        failures.push(`${specifier}: ${error.code ?? ''} ${error.message.split('\n')[0]}`);
      }
      checked++;
    }
  }
  if (failures.length > 0) {
    console.error(`${failures.length} of ${checked} package entries can't be loaded with require():\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`All ${checked} package entries load with require() and match import().`);
}

main();
