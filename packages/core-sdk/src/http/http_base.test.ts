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

import { jest } from "@jest/globals";

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("../log/logger", () => ({
  newLogger: jest.fn(() => mockLogger),
}));

import { HTTPTransport, HTTPTransportOptions } from "./http_base";

describe("HTTPTransport", () => {
  it("should create an instance with baseURL", () => {
    const transport = new HTTPTransport({ url: "https://example.com/api" });
    const instance = transport.getHttpInstance();
    expect(instance.defaults.baseURL).toBe("https://example.com/api");
  });

  it("should configure auth from options", () => {
    const options: HTTPTransportOptions = {
      url: "https://example.com/api",
      auth: {
        type: "basic",
        username: "user",
        password: "pass",
      },
    };
    const transport = new HTTPTransport(options);
    const instance = transport.getHttpInstance();
    const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    expect(instance.defaults.headers.common["Authorization"]).toBe(expected);
  });

  it("should expose getHttpInstance", () => {
    const transport = new HTTPTransport({ url: "https://example.com" });
    expect(transport.getHttpInstance()).toBeDefined();
    expect(transport.getHttpInstance().defaults).toBeDefined();
  });
});
