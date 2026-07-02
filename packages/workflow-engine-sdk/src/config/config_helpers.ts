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


/**
 * Documented shape of the `workflow-engine` YAML section (file → runtime).
 * All fields optional at parse time; validation enforces required fields per mode.
 */
export interface WorkflowEngineYamlSection {
  providerName?: string;
  providerMetadata?: Record<string, unknown>;
  url?: string;
  auth?: unknown;
  maxRetries?: number;
  retryDelay?: string;
  server?: ServerYamlSection;
}

export interface ServerYamlSection {
  address?: string;
  port?: number | string;
  readBufferSize?: number;
  writeBufferSize?: number;
  heartbeatInterval?: string;
  requestsPerSecond?: number;
  burst?: number;
  tls?: TlsYamlSection;
}

export interface TlsYamlSection {
  enabled?: boolean;
  caFile?: string;
  certFile?: string;
  keyFile?: string;
  clientAuth?: boolean;
}

/** Non-empty trimmed string from record[key], or empty string. */
export function cfgStrField(
  rec: Record<string, unknown>,
  key: string,
): string {
  const v = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** String field; if value is number, coerces to string (e.g. retry delay seconds). */
export function cfgStrOrNumAsString(
  rec: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = rec[key];
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return undefined;
}

/** Finite number from record[key] (number or numeric string), or undefined. */
export function cfgNumField(
  rec: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = rec[key];
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Plain object (not array) at record[key], or undefined. */
export function cfgObjField(
  rec: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = rec[key];
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

/** Plain object (not array) at record[key], or undefined. */
export function cfgStringMapField(
  rec: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const v = rec[key];
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, string>;
  }
  return undefined;
}

/** Parsed server address + port for inbound mode; undefined if invalid. */
export function parseInboundServerAddressPort(
  server: Record<string, unknown>,
  addressKey: string,
  portKey: string,
): { address: string; port: number } | undefined {
  const address = cfgStrField(server, addressKey);
  const port = cfgNumField(server, portKey);
  if (!address || port === undefined) {
    return undefined;
  }
  return { address, port };
}

