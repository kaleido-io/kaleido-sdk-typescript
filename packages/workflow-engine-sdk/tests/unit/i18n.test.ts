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
 * Tests for i18n error messages
 */

import { SDKErrors, formatError, newError } from '../../src/i18n/errors';

describe('i18n errors', () => {
  describe('formatError', () => {
    it('should format error with no arguments', () => {
      const result = formatError(SDKErrors.MsgSDKProviderNameNotSet);
      expect(result).toBe('KA140620: Provider name not set');
    });

    it('should format error with string argument', () => {
      const result = formatError(SDKErrors.MsgSDKUnknownHandler, 'my-handler');
      expect(result).toBe("KA140601: Unknown handler 'my-handler'");
    });

    it('should format error with multiple arguments', () => {
      const result = formatError(SDKErrors.MsgSDKInvalidAction, 'myAction', 'myHandler');
      expect(result).toBe("KA140608: Action 'myAction' is invalid for handler 'myHandler'");
    });

    it('should format error with number arguments', () => {
      const result = formatError(SDKErrors.MsgSDKBatchHandlerResultCountMismatch, 5, 10);
      expect(result).toBe('KA140623: Batch handler returned 5 results but expected 10');
    });
  });

  describe('newError', () => {
    it('should create Error with formatted message', () => {
      const err = newError(SDKErrors.MsgSDKHandlerNotConfigured);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('KA140621: Handler not configured for this action');
    });

    it('should create Error with arguments', () => {
      const err = newError(SDKErrors.MsgSDKUnknownHandler, 'test-handler');
      expect(err.message).toBe("KA140601: Unknown handler 'test-handler'");
    });
  });

  describe('SDKErrors constants', () => {
    it('should have correct error codes', () => {
      // Handler errors
      expect(SDKErrors.MsgSDKObservedPanic.code).toBe('KA140600');
      expect(SDKErrors.MsgSDKUnknownHandler.code).toBe('KA140601');
      expect(SDKErrors.MsgSDKDirectorNextStageMissing.code).toBe('KA140604');
      expect(SDKErrors.MsgSDKDirectorOutputPathMissing.code).toBe('KA140605');
      expect(SDKErrors.MsgSDKDirectorFailureStageMissing.code).toBe('KA140606');
      
      // Stage director errors
      expect(SDKErrors.MsgSDKHandlerNotConfigured.code).toBe('KA140621');
      expect(SDKErrors.MsgSDKBatchHandlerNotConfigured.code).toBe('KA140622');
      expect(SDKErrors.MsgSDKBatchHandlerResultCountMismatch.code).toBe('KA140623');
      
      // Configuration errors
      expect(SDKErrors.MsgSDKConfigUnknownAuthType.code).toBe('KA140626');
      
      // Engine errors
      expect(SDKErrors.MsgSDKEngineNotConnected.code).toBe('KA140627');
    });

    it('should have all messages defined', () => {
      // Verify all error messages are non-empty
      Object.values(SDKErrors).forEach((errorMsg) => {
        expect(errorMsg.code).toBeTruthy();
        expect(errorMsg.message).toBeTruthy();
        expect(errorMsg.code).toMatch(/^KA1406\d{2}$/);
      });
    });
  });
});

