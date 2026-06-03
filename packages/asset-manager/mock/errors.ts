// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Error shapes that mirror the Go server's i18n messages so that tests
 * relying on the negative paths see the same error codes they would
 * against a real Asset Manager.
 */
export class MockAssetManagerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(`${code}: ${message}`);
    this.name = "MockAssetManagerError";
  }
}

export const MsgScopeQueryMissed = (objType: string, field: string) =>
  new MockAssetManagerError(
    "KA091215",
    `Cannot query ${objType} by ${field} without parent.type at the same filter level`,
  );

export const MsgScopeNotFound = (target: string, name: string) =>
  new MockAssetManagerError(
    "KA091215",
    `${target} not found for name "${name}"`,
    404,
  );

export const MsgFilterFieldUnknown = (kind: string, field: string) =>
  new MockAssetManagerError(
    "KA090301",
    `Unknown filter field "${field}" on ${kind}`,
  );

export const MsgItemAlreadyExists = (kind: string, name: string) =>
  new MockAssetManagerError(
    "KA090402",
    `${kind} already exists: "${name}"`,
    409,
  );

export const MsgItemNotFound = (kind: string, name: string) =>
  new MockAssetManagerError("KA090301", `${kind} not found: "${name}"`, 404);

export const MsgInvalidRef = (target: string, ref: string) =>
  new MockAssetManagerError(
    "KA090801",
    `Cannot resolve reference to ${target}: "${ref}"`,
  );

export const MsgNotImplementedInMock = (method: string) =>
  new MockAssetManagerError(
    "MOCK000",
    `${method} is not implemented in the AM mock (see plan §6 coverage matrix)`,
    501,
  );
