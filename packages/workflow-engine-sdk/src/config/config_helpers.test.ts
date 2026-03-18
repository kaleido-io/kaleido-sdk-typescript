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

import { describe, it, expect } from "@jest/globals";
import {
  cfgStrField,
  cfgStrOrNumAsString,
  cfgNumField,
  cfgObjField,
  parseInboundServerAddressPort,
} from "./config_helpers";

describe("config_helpers", () => {
  describe("cfgStrField", () => {
    it("returns trimmed string", () => {
      expect(cfgStrField({ a: "  x  " }, "a")).toBe("x");
    });
    it("returns empty for missing or non-string", () => {
      expect(cfgStrField({}, "a")).toBe("");
      expect(cfgStrField({ a: 1 }, "a")).toBe("");
    });
  });

  describe("cfgStrOrNumAsString", () => {
    it("returns string or coerced number", () => {
      expect(cfgStrOrNumAsString({ d: "5s" }, "d")).toBe("5s");
      expect(cfgStrOrNumAsString({ d: 10 }, "d")).toBe("10");
    });
  });

  describe("cfgNumField", () => {
    it("parses number and numeric string", () => {
      expect(cfgNumField({ p: 6000 }, "p")).toBe(6000);
      expect(cfgNumField({ p: "6000" }, "p")).toBe(6000);
    });
    it("returns undefined for invalid", () => {
      expect(cfgNumField({ p: "x" }, "p")).toBeUndefined();
      expect(cfgNumField({ p: NaN }, "p")).toBeUndefined();
    });
  });

  describe("cfgObjField", () => {
    it("returns plain object", () => {
      const o = { x: 1 };
      expect(cfgObjField({ s: o }, "s")).toBe(o);
    });
    it("returns undefined for array or primitive", () => {
      expect(cfgObjField({ s: [] }, "s")).toBeUndefined();
      expect(cfgObjField({ s: "a" }, "s")).toBeUndefined();
    });
  });

  describe("parseInboundServerAddressPort", () => {
    it("parses valid address and port", () => {
      expect(
        parseInboundServerAddressPort(
          { address: "0.0.0.0", port: 6000 },
          "address",
          "port",
        ),
      ).toEqual({ address: "0.0.0.0", port: 6000 });
    });
    it("returns undefined when address or port missing", () => {
      expect(
        parseInboundServerAddressPort({ port: 6000 }, "address", "port"),
      ).toBeUndefined();
      expect(
        parseInboundServerAddressPort({ address: "0.0.0.0" }, "address", "port"),
      ).toBeUndefined();
    });
  });
});
