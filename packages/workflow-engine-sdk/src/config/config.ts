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
import * as yaml from "js-yaml";
import { WorkflowEngineClientConfig, ServerConfig } from "../client/client";
import {
  cfgStrField,
  cfgStrOrNumAsString,
  cfgNumField,
  cfgObjField,
  parseInboundServerAddressPort,
} from "./config_helpers";
import { newLogger } from "../log/logger";
import { SDKErrors, newError } from "../i18n/errors";

/**
 * Environment variable name for the workflow engine config file path.
 */
export const WFE_CONFIG_FILE = "WFE_CONFIG_FILE";

/**
 * Config key names
 */
export const ConfigWorkflowEngineProviderName = "providerName";
export const ConfigWorkflowEngineProviderMetadata = "providerMetadata";
export const ConfigWorkflowEngineUrl = "url";
export const ConfigWorkflowEngineAuth = "auth";
export const ConfigWorkflowEngineMaxRetries = "maxRetries";
export const ConfigWorkflowEngineRetryDelay = "retryDelay";
export const ConfigWorkflowEngineServer = "server";

/**
 * Config key names for server subsection
 */
export const ConfigServerAddress = "address";
export const ConfigServerPort = "port";
export const ConfigServerReadBufferSize = "readBufferSize";
export const ConfigServerWriteBufferSize = "writeBufferSize";
export const ConfigServerHeartbeatInterval = "heartbeatInterval";
export const ConfigServerThrottleRPS = "requestsPerSecond";
export const ConfigServerThrottleBurst = "burst";
export const ConfigServerTls = "tls";

/**
 * Config key names for server.tls subsection
 */
export const ConfigTlsEnabled = "enabled";
export const ConfigTlsCaFile = "caFile";
export const ConfigTlsCertFile = "certFile";
export const ConfigTlsKeyFile = "keyFile";
export const ConfigTlsClientAuth = "clientAuth";

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
      cfgStrOrNumAsString(section, ConfigWorkflowEngineRetryDelay),
    );
  }

  /**
   * Load WorkflowEngineClientConfig from a YAML file.
   * Uses WFE_CONFIG_FILE env if configFilePath is not provided.
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
      process.env[WFE_CONFIG_FILE] ??
      ""
    ).trim();
    if (!configPath) {
      throw newError(SDKErrors.MsgSDKConfigFileNotSet, WFE_CONFIG_FILE);
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
      ConfigWorkflowEngineProviderName,
    );
    if (!providerName) {
      throw newError(SDKErrors.MsgSDKProviderNameNotSet);
    }

    const serverSection = cfgObjField(section, ConfigWorkflowEngineServer);

    const url =
      cfgStrField(section, ConfigWorkflowEngineUrl) || undefined;
    const auth = section[ConfigWorkflowEngineAuth] as
      | WorkflowEngineConfig["workflowEngine"]["auth"]
      | undefined;

    // Inbound: server section only → app creates WebSocket server (no url, no auth)
    const inbound = !url && serverSection;
    if (inbound && serverSection) {
      const addrPort = parseInboundServerAddressPort(
        serverSection,
        ConfigServerAddress,
        ConfigServerPort,
      );
      if (addrPort) {
        const tlsSection = cfgObjField(serverSection, ConfigServerTls);
        const serverConfig: ServerConfig = {
          address: addrPort.address,
          port: addrPort.port,
        };
        if (tlsSection && tlsSection[ConfigTlsEnabled] === true) {
          serverConfig.tls = ConfigLoader.buildServerTlsFromSection(tlsSection);
        }
        const clientConfig: WorkflowEngineClientConfig = {
          server: serverConfig,
          providerName,
          maxAttempts: cfgNumField(
            section,
            ConfigWorkflowEngineMaxRetries,
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
          maxRetries: cfgNumField(
            section,
            ConfigWorkflowEngineMaxRetries,
          ),
          retryDelay: cfgStrOrNumAsString(
            section,
            ConfigWorkflowEngineRetryDelay,
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
    const certFile = cfgStrField(tlsSection, ConfigTlsCertFile);
    const keyFile = cfgStrField(tlsSection, ConfigTlsKeyFile);
    const caFile = cfgStrField(tlsSection, ConfigTlsCaFile);
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
    const caFile = cfgStrField(tlsSection, ConfigTlsCaFile);
    const certFile = cfgStrField(tlsSection, ConfigTlsCertFile);
    const keyFile = cfgStrField(tlsSection, ConfigTlsKeyFile);
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
      ConfigWorkflowEngineProviderMetadata,
    );
    if (!metaObj) {
      return;
    }
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
}
