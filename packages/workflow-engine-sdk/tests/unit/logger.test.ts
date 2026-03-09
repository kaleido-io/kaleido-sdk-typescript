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

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { newLogger, Logger } from '../../src/log/logger';

describe('Logger', () => {
  let mockConsole: any;
  let originalConsole: any;

  beforeEach(() => {
    // Save original console methods
    originalConsole = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error
    };

    // Create mock console methods
    mockConsole = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Replace console methods with mocks
    console.debug = mockConsole.debug;
    console.info = mockConsole.info;
    console.warn = mockConsole.warn;
    console.error = mockConsole.error;
  });

  afterEach(() => {
    // Restore original console methods
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('newLogger', () => {
    it('should create a logger with context', () => {
      const logger = newLogger('test-context');
      
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should create different loggers for different contexts', () => {
      const logger1 = newLogger('context-1');
      const logger2 = newLogger('context-2');
      
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('Logger methods', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = newLogger('test-logger');
    });

    it('should log debug messages with context', () => {
      logger.debug('Debug message');
      
      expect(mockConsole.debug).toHaveBeenCalledWith('[test-logger] Debug message');
    });

    it('should log info messages with context', () => {
      logger.info('Info message');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[test-logger] Info message');
    });

    it('should log warn messages with context', () => {
      logger.warn('Warning message');
      
      expect(mockConsole.warn).toHaveBeenCalledWith('[test-logger] Warning message');
    });

    it('should log error messages with context', () => {
      logger.error('Error message');
      
      expect(mockConsole.error).toHaveBeenCalledWith('[test-logger] Error message');
    });

    it('should handle additional arguments', () => {
      const additionalData = { key: 'value', number: 42 };
      logger.info('Message with data', additionalData);
      
      expect(mockConsole.info).toHaveBeenCalledWith('[test-logger] Message with data', additionalData);
    });

    it('should handle multiple additional arguments', () => {
      logger.error('Error with multiple args', 'arg1', 'arg2', { data: 'test' });
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        '[test-logger] Error with multiple args',
        'arg1',
        'arg2',
        { data: 'test' }
      );
    });

    it('should handle empty messages', () => {
      logger.info('');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[test-logger] ');
    });

    it('should handle special characters in context', () => {
      const specialLogger = newLogger('special-context!@#$%');
      specialLogger.info('Message');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[special-context!@#$%] Message');
    });

    it('should handle long context names', () => {
      const longContext = 'very-long-context-name-that-might-be-used-in-production';
      const longLogger = newLogger(longContext);
      longLogger.info('Message');
      
      expect(mockConsole.info).toHaveBeenCalledWith(`[${longContext}] Message`);
    });
  });

  describe('Logger interface compliance', () => {
    it('should implement the Logger interface correctly', () => {
      const logger = newLogger('test');
      
      // Check that all required methods exist
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should handle all log levels consistently', () => {
      const logger = newLogger('test');
      
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      
      expect(mockConsole.debug).toHaveBeenCalledWith('[test] debug');
      expect(mockConsole.info).toHaveBeenCalledWith('[test] info');
      expect(mockConsole.warn).toHaveBeenCalledWith('[test] warn');
      expect(mockConsole.error).toHaveBeenCalledWith('[test] error');
    });
  });

  describe('Edge cases', () => {
    it('should handle null context', () => {
      const logger = newLogger(null as any);
      logger.info('Message');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[null] Message');
    });

    it('should handle undefined context', () => {
      const logger = newLogger(undefined as any);
      logger.info('Message');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[undefined] Message');
    });

    it('should handle empty context', () => {
      const logger = newLogger('');
      logger.info('Message');
      
      expect(mockConsole.info).toHaveBeenCalledWith('[] Message');
    });

    it('should handle null message', () => {
      const logger = newLogger('test');
      logger.info(null as any);
      
      expect(mockConsole.info).toHaveBeenCalledWith('[test] null');
    });

    it('should handle undefined message', () => {
      const logger = newLogger('test');
      logger.info(undefined as any);
      
      expect(mockConsole.info).toHaveBeenCalledWith('[test] undefined');
    });
  });
}); 