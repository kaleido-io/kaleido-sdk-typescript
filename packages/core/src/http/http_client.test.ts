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

import axios from "axios";
import { configureHttpClient } from "./http_client";

describe("configureHttpClient", () => {
  it("should set timeout on instance defaults", () => {
    const instance = axios.create();
    configureHttpClient(instance, { timeout: 15000 });
    expect(instance.defaults.timeout).toBe(15000);
  });

  it("should default timeout to 30000", () => {
    const instance = axios.create();
    configureHttpClient(instance);
    expect(instance.defaults.timeout).toBe(30000);
  });

  it("should set basic auth header from ServiceBindingAuth", () => {
    const instance = axios.create();
    configureHttpClient(instance, {
      auth: {
        type: "basic",
        username: "myuser",
        password: "mypass",
      },
    });
    const expected = `Basic ${Buffer.from("myuser:mypass").toString("base64")}`;
    expect(instance.defaults.headers.common["Authorization"]).toBe(expected);
  });

  it("should set token auth header with scheme", () => {
    const instance = axios.create();
    configureHttpClient(instance, {
      auth: {
        type: "token",
        token: "my-token",
        scheme: "Bearer",
      },
    });
    expect(instance.defaults.headers.common["Authorization"]).toBe(
      "Bearer my-token",
    );
  });

  it("should set token auth with custom header and no scheme", () => {
    const instance = axios.create();
    configureHttpClient(instance, {
      auth: {
        type: "token",
        token: "raw-token",
        header: "X-Kld-Authz",
        scheme: "",
      },
    });
    expect(instance.defaults.headers.common["X-Kld-Authz"]).toBe("raw-token");
  });

  it("should not set auth header if auth has no credentials", () => {
    const instance = axios.create();
    configureHttpClient(instance, {
      auth: { type: "basic" },
    });
    expect(instance.defaults.headers.common["Authorization"]).toBeUndefined();
  });

  it("should set httpAgent and httpsAgent with keepAlive", () => {
    const instance = axios.create();
    configureHttpClient(instance);
    expect(instance.defaults.httpAgent).toBeDefined();
    expect(instance.defaults.httpsAgent).toBeDefined();
    expect((instance.defaults.httpAgent as any).keepAlive).toBe(true);
    expect((instance.defaults.httpsAgent as any).keepAlive).toBe(true);
  });

  it("should return the same instance", () => {
    const instance = axios.create();
    const result = configureHttpClient(instance);
    expect(result).toBe(instance);
  });
});
