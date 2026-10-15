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

import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import path from "path";
import { ROOT_FIELD } from "./model.js";
import type { BulkModule } from "./types.js";

interface Schema {
  $ref?: string;
  type?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
}

const swagger = yaml.load(
  readFileSync(path.resolve(__dirname, "../swagger/subledger.yaml"), "utf8"),
) as { components: { schemas: Record<string, Schema> } };
const schemas = swagger.components.schemas;

function resolve(schema: Schema): Schema {
  return schema.$ref ? schemas[schema.$ref.split("/").pop()!] : schema;
}

const sections = Object.entries(schemas.BulkUpsertInput.properties!).flatMap(([module, ref]) =>
  Object.entries(resolve(ref).properties!).map(([section, value]) => {
    const scoped = value.type === "array";
    const entry = scoped ? value.items! : value;
    const expected = ["items", "labelStrategy", "options", "updateStrategy"];
    if (scoped) {
      expected.push(ROOT_FIELD[module as BulkModule]!);
    }
    return [`${module}.${section}`, Object.keys(entry.properties!).sort(), expected.sort()];
  }),
);

describe("model", () => {
  it.each(sections)(
    "%s carries the section settings, items and its root field",
    (_, fields, expected) => {
      expect(fields).toEqual(expected);
    },
  );
});
