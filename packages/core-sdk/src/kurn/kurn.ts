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

const PREFIX = "urn:kld:";
const PAIR_SEP = ":";
const TYPE_NAME_SEP = "=";
const MAX_LENGTH = 1024;

const TYPE_TAG = /^[a-z0-9]{2,16}$/;
const NAME = /^[0-9a-zA-Z]([0-9a-zA-Z._-]{0,126}[0-9a-zA-Z])?$/;

/** One type and name pair of a URN. */
export interface Component {
  type: string;
  name: string;
}

/** Build a URN from its components. */
export function urn(...components: Component[]): string {
  if (components.length === 0) {
    throw new Error("KA240302: URN must have at least one name segment");
  }
  const value =
    PREFIX +
    components
      .map(validate)
      .map((c) => c.type + TYPE_NAME_SEP + c.name)
      .join(PAIR_SEP);
  if (value.length > MAX_LENGTH) {
    throw new Error(
      `KA240303: URN exceeds maximum length of ${MAX_LENGTH} characters`,
    );
  }
  return value;
}

/** Build a URN as a child of `parent`. */
export function child(parent: string, type: string, name: string): string {
  return urn(...parse(parent), { type, name });
}

/** Parse a URN into its components. */
export function parse(value: string): Component[] {
  if (value.length > MAX_LENGTH) {
    throw new Error(
      `KA240303: URN exceeds maximum length of ${MAX_LENGTH} characters`,
    );
  }
  if (!value.startsWith(PREFIX)) {
    throw invalidFormat(value);
  }
  return value
    .slice(PREFIX.length)
    .split(PAIR_SEP)
    .map((pair) => {
      const sep = pair.indexOf(TYPE_NAME_SEP);
      if (sep < 0) {
        throw invalidFormat(value);
      }
      return validate({ type: pair.slice(0, sep), name: pair.slice(sep + 1) });
    });
}

/** The URN without its last component; undefined for a single-component URN. */
export function parent(value: string): string | undefined {
  const components = parse(value);
  return components.length > 1 ? urn(...components.slice(0, -1)) : undefined;
}

/** The last component of a URN. */
export function leaf(value: string): Component {
  return parse(value).at(-1)!;
}

/** The first component of a URN, as a URN of its own. */
export function root(value: string): string {
  return urn(parse(value)[0]);
}

function validate(component: Component): Component {
  if (!TYPE_TAG.test(component.type)) {
    throw new Error(`KA240301: Invalid URN type tag '${component.type}'`);
  }
  if (!NAME.test(component.name)) {
    throw new Error(
      `KA240304: URN segment '${component.name}' is not a valid name`,
    );
  }
  return component;
}

function invalidFormat(value: string): Error {
  return new Error(
    `KA240300: Invalid URN '${value}': must start with 'urn:kld:<type>='`,
  );
}
