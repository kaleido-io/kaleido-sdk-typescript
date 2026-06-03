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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, afterEach } from "@jest/globals";

import { mockLogger } from "../../tests/mock-logger";

import {
  AuthConfig,
  AuthType,
  ConfigLoader,
  parseTimeStringToMs,
  timeStringUnitToMs,
  WorkflowEngineConfig,
  KALEIDO_CONFIG_FILE,
  WFE_CONFIG_FILE,
} from "./config";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");

const tokenAuthConfig: WorkflowEngineConfig = {
  workflowEngine: {
    url: "http://localhost:5503",
    auth: {
      type: AuthType.TOKEN,
      token: "dev-token-123",
      header: "X-Kld-Authz",
      scheme: "Bearer",
    },
    maxRetries: 10,
    retryDelay: "2s",
  },
};

const tokenAuthConfigWithDefaultHeaderAndScheme: WorkflowEngineConfig = {
  workflowEngine: {
    url: "http://localhost:5503",
    auth: {
      type: AuthType.TOKEN,
      token: "dev-token-123",
    },
  },
};

const basicAuthConfig: WorkflowEngineConfig = {
  workflowEngine: {
    url: "http://localhost:5503",
    auth: {
      type: AuthType.BASIC,
      username: "admin",
      password: "secret123",
    },
  },
};

const basicAuthConfigHttps: WorkflowEngineConfig = {
  workflowEngine: {
    url: "https://localhost:5503",
    auth: {
      type: AuthType.BASIC,
      username: "admin",
      password: "secret123",
    },
  },
};

const unknownAuthConfig: WorkflowEngineConfig = {
  workflowEngine: {
    url: "http://localhost:5503",
    auth: {
      type: "unknown" as AuthType,
    } as any as AuthConfig,
  },
};

describe("ConfigLoader.httpUrlToWsUrl", () => {
  it("converts http and https and appends /ws", () => {
    expect(ConfigLoader.httpUrlToWsUrl("http://h:1")).toBe("ws://h:1/ws");
    expect(ConfigLoader.httpUrlToWsUrl("https://h:1/path")).toBe(
      "wss://h:1/path/ws",
    );
  });
  it("leaves url ending in /ws unchanged", () => {
    expect(ConfigLoader.httpUrlToWsUrl("ws://h/ws")).toBe("ws://h/ws");
    expect(ConfigLoader.httpUrlToWsUrl("https://h/ws")).toBe("wss://h/ws");
  });
  it("strips trailing slash before appending /ws", () => {
    expect(ConfigLoader.httpUrlToWsUrl("http://h:9/")).toBe("ws://h:9/ws");
  });
  it("appends /ws for non-http schemes", () => {
    expect(ConfigLoader.httpUrlToWsUrl("ws://localhost:1")).toBe(
      "ws://localhost:1/ws",
    );
  });
});

describe("parseTimeStringToMs", () => {
  it("parses s, ms, m, h to milliseconds", () => {
    expect(parseTimeStringToMs("2s")).toBe(2000);
    expect(parseTimeStringToMs("30s")).toBe(30000);
    expect(parseTimeStringToMs("100ms")).toBe(100);
    expect(parseTimeStringToMs("1m")).toBe(60000);
    expect(parseTimeStringToMs("1h")).toBe(3600000);
    expect(parseTimeStringToMs("1.5s")).toBe(1500);
  });
  it("returns NaN for invalid strings", () => {
    expect(parseTimeStringToMs("")).toBeNaN();
    expect(parseTimeStringToMs("x")).toBeNaN();
    expect(parseTimeStringToMs("10")).toBeNaN();
    expect(parseTimeStringToMs("10sec")).toBeNaN();
  });
});

describe("timeStringUnitToMs", () => {
  it("returns NaN for unknown unit (defensive)", () => {
    expect(timeStringUnitToMs(1, "days")).toBeNaN();
  });
});

describe("ConfigLoader.retryDelayMsFromSection", () => {
  it("defaults to 2000 when missing", () => {
    expect(ConfigLoader.retryDelayMsFromSection({})).toBe(2000);
  });
  it("parses time strings", () => {
    expect(
      ConfigLoader.retryDelayMsFromSection({ retryDelay: "5s" }),
    ).toBe(5000);
    expect(
      ConfigLoader.retryDelayMsFromSection({ retryDelay: "100ms" }),
    ).toBe(100);
  });
  it("coerces plain number to seconds", () => {
    expect(ConfigLoader.retryDelayMsFromSection({ retryDelay: 3 })).toBe(3000);
  });
  it("falls back on invalid", () => {
    expect(
      ConfigLoader.retryDelayMsFromSection({ retryDelay: "not-a-time" }),
    ).toBe(2000);
  });
});

describe("ConfigLoader.buildTlsOptionsFromSection", () => {
  const fixture = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "wfe-config.yaml",
  );
  it("sets rejectUnauthorized false when no caFile", () => {
    const opts = ConfigLoader.buildTlsOptionsFromSection({
      certFile: fixture,
      keyFile: fixture,
    });
    expect(opts.rejectUnauthorized).toBe(false);
  });
  it("sets rejectUnauthorized true and reads ca when caFile set", () => {
    const opts = ConfigLoader.buildTlsOptionsFromSection({
      caFile: fixture,
      certFile: fixture,
      keyFile: fixture,
    });
    expect(opts.rejectUnauthorized).toBe(true);
    expect(opts.ca?.length).toBeGreaterThan(0);
    expect(opts.cert?.length).toBeGreaterThan(0);
    expect(opts.key?.length).toBeGreaterThan(0);
  });
});

describe("ConfigLoader", () => {
  it("should create client config with token auth", async () => {
    const clientConfig = ConfigLoader.createClientConfig(
      tokenAuthConfig,
      "my-service",
    );
    expect(clientConfig).toBeDefined();
    expect(clientConfig.providerName).toBe("my-service");
    expect(clientConfig.url).toBe("ws://localhost:5503/ws");
    expect(clientConfig.options?.headers).toBeDefined();
    expect(clientConfig.options?.headers["X-Kld-Authz"]).toBe(
      "Bearer dev-token-123",
    );
    expect(clientConfig.maxAttempts).toBe(10);
    expect(clientConfig.reconnectDelay).toBe(2000);
  });
  it("should parse retryDelay time strings (e.g. 30s, 100ms)", () => {
    const config: WorkflowEngineConfig = {
      workflowEngine: {
        url: "http://localhost:5503",
        auth: { type: AuthType.TOKEN, token: "t" },
        retryDelay: "30s",
      },
    };
    const clientConfig = ConfigLoader.createClientConfig(config, "svc");
    expect(clientConfig.reconnectDelay).toBe(30000);
  });
  it("should treat plain numeric retryDelay as seconds (createClientConfig, matches file YAML)", () => {
    const config: WorkflowEngineConfig = {
      workflowEngine: {
        url: "http://localhost:5503",
        auth: { type: AuthType.TOKEN, token: "t" },
        retryDelay: "3",
      },
    };
    expect(ConfigLoader.createClientConfig(config, "svc").reconnectDelay).toBe(
      3000,
    );
  });
  it("should use 2000ms reconnectDelay when retryDelay is invalid", () => {
    const config: WorkflowEngineConfig = {
      workflowEngine: {
        url: "http://localhost:5503",
        auth: { type: AuthType.TOKEN, token: "t" },
        retryDelay: "not-a-duration",
      },
    };
    expect(ConfigLoader.createClientConfig(config, "svc").reconnectDelay).toBe(
      2000,
    );
  });
  it("should create client config with token auth with default header and scheme", async () => {
    const clientConfig = ConfigLoader.createClientConfig(
      tokenAuthConfigWithDefaultHeaderAndScheme,
      "my-service",
    );
    expect(clientConfig).toBeDefined();
    expect(clientConfig.url).toBe("ws://localhost:5503/ws");
    expect(clientConfig.providerName).toBe("my-service");
    expect(clientConfig.options?.headers).toBeDefined();
    expect(clientConfig.options?.headers["Authorization"]).toBe(
      "dev-token-123",
    );
  });
  it("should create client config with basic auth", async () => {
    const clientConfig = ConfigLoader.createClientConfig(
      basicAuthConfig,
      "my-service",
    );
    expect(clientConfig).toBeDefined();
    expect(clientConfig.url).toBe("ws://localhost:5503/ws");
    expect(clientConfig.providerName).toBe("my-service");
    expect(clientConfig.options?.headers).toBeDefined();
    expect(clientConfig.options?.headers["Authorization"]).toBe(
      "Basic YWRtaW46c2VjcmV0MTIz",
    );
  });
  it("should create client config with basic auth https", async () => {
    const clientConfig = ConfigLoader.createClientConfig(
      basicAuthConfigHttps,
      "my-service",
    );
    expect(clientConfig).toBeDefined();
    expect(clientConfig.url).toBe("wss://localhost:5503/ws");
    expect(clientConfig.providerName).toBe("my-service");
    expect(clientConfig.options?.headers).toBeDefined();
    expect(clientConfig.options?.headers["Authorization"]).toBe(
      "Basic YWRtaW46c2VjcmV0MTIz",
    );
  });
  it("should throw an error if the auth type is unknown", async () => {
    expect(() =>
      ConfigLoader.createClientConfig(unknownAuthConfig, "my-service"),
    ).toThrow("Unknown auth type: unknown");
  });
  it("should log a summary", async () => {
    ConfigLoader.logConfigSummary(basicAuthConfig);
    expect(mockLogger.info).toHaveBeenCalledWith("Configuration loaded:");
    expect(mockLogger.info).toHaveBeenCalledWith(
      "  Workflow Engine: http://localhost:5503",
    );
    expect(mockLogger.info).toHaveBeenCalledWith("  Auth Type: basic");
    expect(mockLogger.info).toHaveBeenCalledWith("  Username: admin");
    mockLogger.info.mockClear();
    ConfigLoader.logConfigSummary(tokenAuthConfig);
    expect(mockLogger.info).toHaveBeenCalledWith("Configuration loaded:");
    expect(mockLogger.info).toHaveBeenCalledWith(
      "  Workflow Engine: http://localhost:5503",
    );
    expect(mockLogger.info).toHaveBeenCalledWith("  Auth Type: token");
    expect(mockLogger.info).toHaveBeenCalledWith("  Auth Header: X-Kld-Authz");
    expect(mockLogger.info).toHaveBeenCalledWith("  Auth Scheme: Bearer");
    expect(mockLogger.info).toHaveBeenCalledWith("  Max Retries: 10");
    expect(mockLogger.info).toHaveBeenCalledWith("  Retry Delay: 2s");
    mockLogger.info.mockClear();
    ConfigLoader.logConfigSummary(tokenAuthConfigWithDefaultHeaderAndScheme);
    expect(mockLogger.info).toHaveBeenCalledWith(
      "  Auth Header: Authorization",
    );
  });

  describe("loadClientConfigFromFile", () => {
    const originalEnv = process.env[KALEIDO_CONFIG_FILE];
    const originalWfeEnv = process.env[WFE_CONFIG_FILE];

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env[KALEIDO_CONFIG_FILE] = originalEnv;
      } else {
        delete process.env[KALEIDO_CONFIG_FILE];
      }
      if (originalWfeEnv !== undefined) {
        process.env[WFE_CONFIG_FILE] = originalWfeEnv;
      } else {
        delete process.env[WFE_CONFIG_FILE];
      }
    });

    it("should load client config from file with workflow-engine root key", () => {
      const configPath = path.join(FIXTURES_DIR, "wfe-config.yaml");
      const clientConfig = ConfigLoader.loadClientConfigFromFile(configPath);
      expect(clientConfig).toBeDefined();
      expect(clientConfig.providerName).toBe("test-provider");
      expect(clientConfig.url).toBe("ws://localhost:5503/ws");
      expect(clientConfig.options?.headers?.["X-Kld-Authz"]).toBe(
        "dev-token-123",
      );
      expect(clientConfig.reconnectDelay).toBe(2000);
    });

    it("should throw when config file does not exist", () => {
      expect(() =>
        ConfigLoader.loadClientConfigFromFile("/nonexistent/wfe-config.yaml"),
      ).toThrow();
    });

    it("should throw when YAML root is not an object", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-yaml-"));
      try {
        const p = path.join(tmpDir, "bad.yaml");
        fs.writeFileSync(p, "plain-scalar-root");
        expect(() => ConfigLoader.loadClientConfigFromFile(p)).toThrow(
          /Invalid workflow engine config file/,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should throw when workflow-engine section is missing", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-yaml-"));
      try {
        const p = path.join(tmpDir, "bad.yaml");
        fs.writeFileSync(p, "other: 1\n");
        expect(() => ConfigLoader.loadClientConfigFromFile(p)).toThrow(
          /Missing "workflow-engine" section/,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should throw when providerName is missing", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-yaml-"));
      try {
        const p = path.join(tmpDir, "bad.yaml");
        fs.writeFileSync(
          p,
          "workflow-engine:\n  url: http://localhost:1\n  auth:\n    type: token\n    token: t\n",
        );
        expect(() => ConfigLoader.loadClientConfigFromFile(p)).toThrow(
          /Provider name not set/,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should throw when url is set but auth is missing", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-yaml-"));
      try {
        const p = path.join(tmpDir, "bad.yaml");
        fs.writeFileSync(
          p,
          "workflow-engine:\n  providerName: p\n  url: http://localhost:1\n",
        );
        expect(() => ConfigLoader.loadClientConfigFromFile(p)).toThrow(
          /Missing url or auth/,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should parse numeric retryDelay as seconds for outbound file load (same as inbound)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-retry-"));
      try {
        const p = path.join(tmpDir, "wfe.yaml");
        fs.writeFileSync(
          p,
          `workflow-engine:
  providerName: outbound-num-retry
  url: http://localhost:5503
  auth:
    type: token
    token: t
  retryDelay: 3
`,
        );
        const c = ConfigLoader.loadClientConfigFromFile(p);
        expect(c.reconnectDelay).toBe(3000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should apply providerMetadata with only string values", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-meta-"));
      try {
        const p = path.join(tmpDir, "wfe.yaml");
        fs.writeFileSync(
          p,
          `workflow-engine:
  providerName: meta-p
  providerMetadata:
    displayName: "Example"
    skipMe: 99
  server:
    address: "127.0.0.1"
    port: 5555
`,
        );
        const c = ConfigLoader.loadClientConfigFromFile(p);
        expect(c.providerMetadata).toEqual({ displayName: "Example" });
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should omit providerMetadata when only non-string entries", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-meta-"));
      try {
        const p = path.join(tmpDir, "wfe.yaml");
        fs.writeFileSync(
          p,
          `workflow-engine:
  providerName: meta-p
  providerMetadata:
    n: 1
  server:
    address: "127.0.0.1"
    port: 5555
`,
        );
        const c = ConfigLoader.loadClientConfigFromFile(p);
        expect(c.providerMetadata).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should throw when path is blank and KALEIDO_CONFIG_FILE is not set", () => {
      delete process.env[KALEIDO_CONFIG_FILE];
      delete process.env[WFE_CONFIG_FILE];
      expect(() => ConfigLoader.loadClientConfigFromFile("")).toThrow(
        "Workflow engine config file not set",
      );
      expect(() => ConfigLoader.loadClientConfigFromFile()).toThrow(
        "Workflow engine config file not set",
      );
    });

    it("should use KALEIDO_CONFIG_FILE when path is not provided", () => {
      const configPath = path.join(FIXTURES_DIR, "wfe-config.yaml");
      process.env[KALEIDO_CONFIG_FILE] = configPath;
      delete process.env[WFE_CONFIG_FILE];
      const clientConfig = ConfigLoader.loadClientConfigFromFile();
      expect(clientConfig).toBeDefined();
      expect(clientConfig.providerName).toBe("test-provider");
    });

    it("should fall back to WFE_CONFIG_FILE when KALEIDO_CONFIG_FILE is not set", () => {
      const configPath = path.join(FIXTURES_DIR, "wfe-config.yaml");
      delete process.env[KALEIDO_CONFIG_FILE];
      process.env[WFE_CONFIG_FILE] = configPath;
      const clientConfig = ConfigLoader.loadClientConfigFromFile();
      expect(clientConfig).toBeDefined();
      expect(clientConfig.providerName).toBe("test-provider");
    });

    it("should load client config for inbound (server only, no auth)", () => {
      const configPath = path.join(FIXTURES_DIR, "wfe-config-hosted.yaml");
      const clientConfig = ConfigLoader.loadClientConfigFromFile(configPath);
      expect(clientConfig).toBeDefined();
      expect(clientConfig.providerName).toBe("hosted-provider");
      expect(clientConfig.url).toBeUndefined();
      expect(clientConfig.server).toBeDefined();
      expect(clientConfig.server?.address).toBe("0.0.0.0");
      expect(clientConfig.server?.port).toBe(6000);
      expect(clientConfig.server?.tls).toBeUndefined();
    });

    it("should throw when server present but address missing (inbound invalid)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-bad-"));
      try {
        const badYaml = `
workflow-engine:
  providerName: bad-inbound
  server:
    port: 6000
`;
        const configPath = path.join(tmpDir, "wfe.yaml");
        fs.writeFileSync(configPath, badYaml);
        expect(() => ConfigLoader.loadClientConfigFromFile(configPath)).toThrow(
          /Missing url or auth/,
        );
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("should load client config for inbound with server.tls (WebSocket server TLS)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfe-tls-"));
      try {
        const caFile = path.join(tmpDir, "ca.crt");
        const certFile = path.join(tmpDir, "tls.crt");
        const keyFile = path.join(tmpDir, "tls.key");
        fs.writeFileSync(caFile, "mock-ca");
        fs.writeFileSync(certFile, "mock-cert");
        fs.writeFileSync(keyFile, "mock-key");
        const tlsYaml = `
workflow-engine:
  providerName: tls-provider
  providerMetadata: {}
  server:
    address: "0.0.0.0"
    port: 6000
    tls:
      enabled: true
      caFile: "${caFile.replace(/\\/g, "/")}"
      certFile: "${certFile.replace(/\\/g, "/")}"
      keyFile: "${keyFile.replace(/\\/g, "/")}"
      clientAuth: true
`;
        const configPath = path.join(tmpDir, "wfe-config.yaml");
        fs.writeFileSync(configPath, tlsYaml);
        const clientConfig = ConfigLoader.loadClientConfigFromFile(configPath);
        expect(clientConfig).toBeDefined();
        expect(clientConfig.providerName).toBe("tls-provider");
        expect(clientConfig.url).toBeUndefined();
        expect(clientConfig.server).toBeDefined();
        expect(clientConfig.server?.address).toBe("0.0.0.0");
        expect(clientConfig.server?.port).toBe(6000);
        expect(clientConfig.server?.tls?.enabled).toBe(true);
        expect(clientConfig.server?.tls?.ca?.toString()).toBe("mock-ca");
        expect(clientConfig.server?.tls?.cert?.toString()).toBe("mock-cert");
        expect(clientConfig.server?.tls?.key?.toString()).toBe("mock-key");
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });
  });
});
