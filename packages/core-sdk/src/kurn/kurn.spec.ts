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
import { child, leaf, parent, parse, root, urn } from "./kurn.js";

describe("kurn", () => {
  it("round-trips URNs through parse and urn", () => {
    for (const s of [
      "urn:kld:asset=USDC",
      "urn:kld:asset=USDC:assetinst=eth-mainnet-usdc",
      "urn:kld:asset=mixed_CASE-numb3rs.are_FINE",
      "urn:kld:org=acme:proj=infra:wfl=settle:stp=1",
    ]) {
      expect(urn(...parse(s))).toBe(s);
    }
    expect(
      urn(
        { type: "asset", name: "USDC" },
        { type: "assetinst", name: "eth-mainnet-usdc" },
      ),
    ).toBe("urn:kld:asset=USDC:assetinst=eth-mainnet-usdc");
  });

  it("builds a child under a parent", () => {
    expect(child("urn:kld:chain=eth", "transaction", "0xabc")).toBe(
      "urn:kld:chain=eth:transaction=0xabc",
    );
    expect(() => child("not-a-urn", "transaction", "0xabc")).toThrow(
      "KA240300",
    );
  });

  it("navigates parent, leaf and root", () => {
    const nested = "urn:kld:book=main:account=omni:account=leaf";
    expect(parent(nested)).toBe("urn:kld:book=main:account=omni");
    expect(leaf(nested)).toEqual({ type: "account", name: "leaf" });
    expect(root(nested)).toBe("urn:kld:book=main");

    const flat = "urn:kld:asset=USD";
    expect(parent(flat)).toBeUndefined();
    expect(leaf(flat)).toEqual({ type: "asset", name: "USD" });
    expect(root(flat)).toBe(flat);
  });

  it("rejects malformed components", () => {
    expect(() => urn()).toThrow("KA240302");
    expect(() => urn({ type: "", name: "eth-mainnet" })).toThrow("KA240301");
    expect(() => urn({ type: "RAL", name: "eth-mainnet" })).toThrow("KA240301");
    for (const name of [
      "",
      "has spaces",
      "has=equals",
      "alice::1220abcd",
      "_leading",
      "trailing-",
      "a".repeat(129),
    ]) {
      expect(() => urn({ type: "ral", name })).toThrow("KA240304");
    }
    expect(urn({ type: "ral", name: "a".repeat(128) })).toBe(
      `urn:kld:ral=${"a".repeat(128)}`,
    );
    const name = "a".repeat(128);
    expect(() =>
      urn(...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ type: `a${i}`, name }))),
    ).toThrow("KA240303");
  });

  it("rejects malformed URNs", () => {
    expect(() => parse("not-a-urn")).toThrow("KA240300");
    expect(() => parse("urn:kld:ral")).toThrow("KA240300");
    expect(() => parse("urn:kld:RAL=foo")).toThrow("KA240301");
    expect(() => parse(`urn:kld:ral=${"a".repeat(1024)}`)).toThrow("KA240303");
    expect(() => parse("urn:kld:ral=has spaces")).toThrow("KA240304");
    expect(() => parse("urn:kld:asset=USDC:")).toThrow("KA240300");
  });
});
