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
import yaml from "js-yaml";
import { WorkflowEngineClientConfig, ServerConfig } from "../client/client";
import {
  cfgStrField,
  cfgStrOrNumAsString,
  cfgNumField,
  cfgObjField,
  parseInboundServerAddressPort,
  cfgStringMapField,
} from "./config_helpers";
import { newLogger } from '@kaleido-io/core-sdk/log';
import { SDKErrors, newError } from "../i18n/errors";
import {
  ServiceBindingsMap,
} from "../service/types";
import { loadServiceBindings, parseServiceBindingsSection } from "@kaleido-io/core-sdk";

/**
 * Environment variable name for the Kaleido-managed config file path (service bindings etc.).
 */
export const KALEIDO_CONFIG_FILE = "KALEIDO_CONFIG_FILE";

/** @deprecated Use KALEIDO_CONFIG_FILE */
export const WFE_CONFIG_FILE = "WFE_CONFIG_FILE";

/**
 * Environment variable name for the developer-managed provider-specific config file path.
 * When set, takes precedence over the default path './config/provider-config.yaml'.
 */
export const CONFIG_FILE = "CONFIG_FILE";

const WFE_CONFIG_KEYS = {
  providerName: "providerName",
  providerMetadata: "providerMetadata",
  url: "url",
  auth: "auth",
  maxRetries: "maxRetries",
  retryDelay: "retryDelay",
  server: "server",
  headers: "headers",
} as const;

const SERVER_CONFIG_KEYS = {
  address: "address",
  port: "port",
  readBufferSize: "readBufferSize",
  writeBufferSize: "writeBufferSize",
  heartbeatInterval: "heartbeatInterval",
  throttleRPS: "requestsPerSecond",
  throttleBurst: "burst",
  tls: "tls",
} as const;

const TLS_CONFIG_KEYS = {
  enabled: "enabled",
  caFile: "caFile",
  certFile: "certFile",
  keyFile: "keyFile",
  clientAuth: "clientAuth",
} as const;

const log = newLogger("config");

/**
 * Parse a time string to milliseconds. Supports: ms, s, m, h (e.g. "30s", "100ms", "1m").
 * Returns NaN if the string is invalid.
 */
export function parseTimeStringToMs(value: string): number {
  const s = value.trim();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (!match) return NaN;
  const n = parseFloat(match[1]);
  // Group 2 is always ms|s|m|h when the full pattern matches.
  const unit = match[2]!.toLowerCase();
  return timeStringUnitToMs(n, unit);
}

/** @internal exposed for tests — defensive NaN when unit is not ms|s|m|h */
export function timeStringUnitToMs(n: number, unitLower: string): number {
  if (unitLower === "ms") {
    return n;
  }
  if (unitLower === "s") {
    return n * 1000;
  }
  if (unitLower === "m") {
    return n * 60 * 1000;
  }
  if (unitLower === "h") {
    return n * 60 * 60 * 1000;
  }
  return NaN;
}

/**
 * Authentication type enum
 */
export enum AuthType {
  BASIC = "basic",
  TOKEN = "token",
}

/**
 * Basic authentication using username and password
 */
export interface BasicAuth {
  type: AuthType.BASIC;
  username: string;
  password: string;
}

/**
 * Token-based authentication
 */
export interface TokenAuth {
  type: AuthType.TOKEN;
  token: string;
  header?: string; // Header name (default: Authorization)
  scheme?: string; // Auth scheme: Bearer, Basic, or empty for raw token
}

/**
 * Authentication configuration (discriminated union)
 */
export type AuthConfig = BasicAuth | TokenAuth;

/**
 * Standard configuration structure for workflow engine connectors
 *
 * This configuration should be provided by the application using the SDK.
 * The SDK does not load configuration from files - it receives it from the caller.
 */
export interface WorkflowEngineConfig {
  workflowEngine: {
    url: string;
    auth: AuthConfig;
    headers?: Record<string, string>;
    maxRetries?: number;
    retryDelay?: string;
  };
}

/**
 * Configuration utility for transforming WorkflowEngineConfig into client config
 *
 * The SDK receives configuration objects - it does not load from files.
 * Applications using this SDK should load configuration themselves and pass it in.
 */
export class ConfigLoader {
  /**
   * Create WorkflowEngineClientConfig from WorkflowEngineConfig
   */
  static createClientConfig(
    config: WorkflowEngineConfig,
    providerName: string,
  ): WorkflowEngineClientConfig {
    const auth = config.workflowEngine.auth;
    let headerName: string;
    let authValue: string;

    // Use discriminated union to handle different auth types
    switch (auth.type) {
      case AuthType.BASIC: {
        headerName = "Authorization";
        const credentials = Buffer.from(
          `${auth.username}:${auth.password}`,
        ).toString("base64");
        authValue = `Basic ${credentials}`;
        break;
      }

      case AuthType.TOKEN: {
        headerName = auth.header || "Authorization";
        const scheme = auth.scheme || "";
        authValue = scheme ? `${scheme} ${auth.token}` : auth.token;
        break;
      }

      default: {
        // TypeScript ensures this is unreachable if all cases are handled
        const _exhaustive: never = auth;
        throw newError(
          SDKErrors.MsgSDKConfigUnknownAuthType,
          (_exhaustive as any).type,
        );
      }
    }

    return {
      url: ConfigLoader.httpUrlToWsUrl(config.workflowEngine.url),
      headers: config.workflowEngine.headers,
      providerName,
      options: {
        headers: {
          [headerName]: authValue,
        },
      },
      maxAttempts: config.workflowEngine.maxRetries, // undefined = infinite retries
      reconnectDelay: ConfigLoader.retryDelayRawToMs(
        config.workflowEngine.retryDelay,
      ),
    };
  }

  /**
   * Parse retry delay: plain integer (or digits-only string) = seconds; otherwise time string (2s, 100ms, 1m, 1h).
   * Matches file-loader behavior for inbound/outbound.
   */
  static retryDelayRawToMs(raw: string | undefined): number {
    const s = raw?.trim();
    if (!s) {
      return 2000;
    }
    const ms = parseTimeStringToMs(/^\d+$/.test(s) ? `${s}s` : s);
    return Number.isNaN(ms) ? 2000 : ms;
  }

  /**
   * Build WebSocket URL from HTTP(S) base URL (add /ws, convert scheme).
   */
  static httpUrlToWsUrl(baseUrl: string): string {
    let wsUrl = baseUrl;
    if (wsUrl.startsWith("http://")) {
      wsUrl = "ws://" + wsUrl.substring(7);
    } else if (wsUrl.startsWith("https://")) {
      wsUrl = "wss://" + wsUrl.substring(8);
    }
    if (!wsUrl.endsWith("/ws")) {
      wsUrl = wsUrl.replace(/\/$/, "") + "/ws";
    }
    return wsUrl;
  }

  static retryDelayMsFromSection(section: Record<string, unknown>): number {
    return ConfigLoader.retryDelayRawToMs(
      cfgStrOrNumAsString(section, WFE_CONFIG_KEYS.retryDelay),
    );
  }

  /**
   * Load WorkflowEngineClientConfig from a YAML file.
   * Uses KALEIDO_CONFIG_FILE env (or WFE_CONFIG_FILE for backward compatibility) if configFilePath is not provided.
   * Only the root key "workflow-engine" is supported in the config file.
   *
   * - Outbound: use "url" and "auth"; the app connects to the workflow engine.
   * - Inbound: use "server" (address, port, etc.); the app creates a WebSocket server and the engine connects to it. Auth is not used.
   */
  static loadClientConfigFromFile(
    configFilePath?: string,
  ): WorkflowEngineClientConfig {
    const configPath = (
      configFilePath ??
      process.env[KALEIDO_CONFIG_FILE] ??
      process.env[WFE_CONFIG_FILE] ??
      ""
    ).trim();
    if (!configPath) {
      throw newError(SDKErrors.MsgSDKConfigFileNotSet, KALEIDO_CONFIG_FILE);
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
    if (!parsed || typeof parsed !== "object") {
      throw newError(SDKErrors.MsgSDKConfigFileInvalid, configPath);
    }
    const section = parsed["workflow-engine"] as
      | Record<string, unknown>
      | undefined;
    if (!section || typeof section !== "object") {
      throw newError(SDKErrors.MsgSDKConfigSectionMissing, configPath);
    }

    const providerName = cfgStrField(
      section,
      WFE_CONFIG_KEYS.providerName,
    );
    if (!providerName) {
      throw newError(SDKErrors.MsgSDKProviderNameNotSet);
    }

    const serverSection = cfgObjField(section, WFE_CONFIG_KEYS.server);

    const url =
      cfgStrField(section, WFE_CONFIG_KEYS.url) || undefined;
    const headers =
      cfgStringMapField(section, WFE_CONFIG_KEYS.headers) || undefined;
    const auth = section[WFE_CONFIG_KEYS.auth] as
      | WorkflowEngineConfig["workflowEngine"]["auth"]
      | undefined;

    // Inbound: server section only → app creates WebSocket server (no url, no auth)
    const inbound = !url && serverSection;
    if (inbound && serverSection) {
      const addrPort = parseInboundServerAddressPort(
        serverSection,
        SERVER_CONFIG_KEYS.address,
        SERVER_CONFIG_KEYS.port,
      );
      if (addrPort) {
        const tlsSection = cfgObjField(serverSection, SERVER_CONFIG_KEYS.tls);
        const serverConfig: ServerConfig = {
          address: addrPort.address,
          port: addrPort.port,
        };
        if (tlsSection && tlsSection[TLS_CONFIG_KEYS.enabled] === true) {
          serverConfig.tls = ConfigLoader.buildServerTlsFromSection(tlsSection);
        }
        const clientConfig: WorkflowEngineClientConfig = {
          server: serverConfig,
          headers,
          providerName,
          maxAttempts: cfgNumField(
            section,
            WFE_CONFIG_KEYS.maxRetries,
          ),
          reconnectDelay: ConfigLoader.retryDelayMsFromSection(section),
        };
        ConfigLoader.applyProviderMetadata(clientConfig, section);
        return clientConfig;
      }
    }

    if (!url) {
      throw newError(SDKErrors.MsgSDKConfigUrlAuthMissing, configPath);
    }

    // Outbound: url + auth → use createClientConfig
    if (auth && typeof auth === "object") {
      const engineConfig: WorkflowEngineConfig = {
        workflowEngine: {
          url,
          auth,
          headers,
          maxRetries: cfgNumField(
            section,
            WFE_CONFIG_KEYS.maxRetries,
          ),
          retryDelay: cfgStrOrNumAsString(
            section,
            WFE_CONFIG_KEYS.retryDelay,
          ),
        },
      };
      const clientConfig = ConfigLoader.createClientConfig(
        engineConfig,
        providerName,
      );
      ConfigLoader.applyProviderMetadata(clientConfig, section);
      return clientConfig;
    }

    throw newError(SDKErrors.MsgSDKConfigUrlAuthMissing, configPath);
  }

  /**
   * Build server TLS config from server.tls section (for inbound WebSocket server).
   * Reads caFile, certFile, keyFile and returns { enabled, ca?, cert?, key? }.
   */
  static buildServerTlsFromSection(tlsSection: Record<string, unknown>): {
    enabled: boolean;
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
  } {
    const certFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.certFile);
    const keyFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.keyFile);
    const caFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.caFile);
    return {
      enabled: true,
      ...(caFile && { ca: fs.readFileSync(caFile) }),
      ...(certFile && { cert: fs.readFileSync(certFile) }),
      ...(keyFile && { key: fs.readFileSync(keyFile) }),
    };
  }

  /**
   * Build WebSocket client TLS options from server.tls config section (outbound client).
   * Reads caFile, certFile, keyFile and returns options suitable for ws client (ca, cert, key, rejectUnauthorized).
   */
  static buildTlsOptionsFromSection(tlsSection: Record<string, unknown>): {
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
    rejectUnauthorized?: boolean;
  } {
    const opts: {
      ca?: Buffer;
      cert?: Buffer;
      key?: Buffer;
      rejectUnauthorized?: boolean;
    } = {};
    const caFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.caFile);
    const certFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.certFile);
    const keyFile = cfgStrField(tlsSection, TLS_CONFIG_KEYS.keyFile);
    if (caFile) {
      opts.ca = fs.readFileSync(caFile);
      opts.rejectUnauthorized = true;
    } else {
      opts.rejectUnauthorized = false;
    }
    if (certFile) opts.cert = fs.readFileSync(certFile);
    if (keyFile) opts.key = fs.readFileSync(keyFile);
    return opts;
  }

  private static applyProviderMetadata(
    clientConfig: WorkflowEngineClientConfig,
    section: Record<string, unknown>,
  ): void {
    const metaObj = cfgObjField(
      section,
      WFE_CONFIG_KEYS.providerMetadata,
    );
    if (metaObj) {
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(metaObj)) {
        if (typeof v === "string") {
          meta[k] = v;
        }
      }
      if (Object.keys(meta).length > 0) {
        clientConfig.providerMetadata = meta;
      }
    }
  }

  /**
   * Log configuration summary (without sensitive data)
   */
  static logConfigSummary(config: WorkflowEngineConfig): void {
    log.info("Configuration loaded:");
    log.info(`  Workflow Engine: ${config.workflowEngine.url}`);

    const auth = config.workflowEngine.auth;
    switch (auth.type) {
      case AuthType.BASIC:
        log.info(`  Auth Type: ${AuthType.BASIC}`);
        log.info(`  Username: ${auth.username}`);
        break;
      case AuthType.TOKEN:
        log.info(`  Auth Type: ${AuthType.TOKEN}`);
        log.info(`  Auth Header: ${auth.header || "Authorization"}`);
        if (auth.scheme) {
          log.info(`  Auth Scheme: ${auth.scheme}`);
        }
        break;
    }

    if (config.workflowEngine.maxRetries) {
      log.info(`  Max Retries: ${config.workflowEngine.maxRetries}`);
    }

    if (config.workflowEngine.retryDelay) {
      log.info(`  Retry Delay: ${config.workflowEngine.retryDelay}`);
    }
  }

  static loadServiceBindings(configFilePath?: string): ServiceBindingsMap {
    return loadServiceBindings(configFilePath);
  }

  static parseServiceBindingsSection(section: Record<string, unknown>): ServiceBindingsMap {
    return parseServiceBindingsSection(section);
  }
}
