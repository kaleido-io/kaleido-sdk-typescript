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
import { newLogger, setLoggerFactory, defaultLoggerFactory, Logger, LoggerFactory } from '../../src/log/logger';

// Matches e.g. "2026-05-13T14:23:45.123Z "
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;

describe('Logger', () => {
  let consoleMock: Record<string, jest.Mock>;
  let originalConsole: Record<string, any>;

  beforeEach(() => {
    originalConsole = {
      debug: console.debug,
      info:  console.info,
      warn:  console.warn,
      error: console.error,
    };
    consoleMock = {
      debug: jest.fn(),
      info:  jest.fn(),
      warn:  jest.fn(),
      error: jest.fn(),
    };
    console.debug = consoleMock.debug as any;
    console.info  = consoleMock.info  as any;
    console.warn  = consoleMock.warn  as any;
    console.error = consoleMock.error as any;
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info  = originalConsole.info;
    console.warn  = originalConsole.warn;
    console.error = originalConsole.error;
    setLoggerFactory(defaultLoggerFactory);
  });

  describe('default ConsoleLogger format', () => {
    it('includes ISO timestamp for debug', () => {
      newLogger('ctx').debug('msg');
      expect((consoleMock.debug.mock.calls[0] as string[])[0]).toMatch(ISO_TIMESTAMP);
    });

    it('includes ISO timestamp for info', () => {
      newLogger('ctx').info('msg');
      expect((consoleMock.info.mock.calls[0] as string[])[0]).toMatch(ISO_TIMESTAMP);
    });

    it('includes ISO timestamp for warn', () => {
      newLogger('ctx').warn('msg');
      expect((consoleMock.warn.mock.calls[0] as string[])[0]).toMatch(ISO_TIMESTAMP);
    });

    it('includes ISO timestamp for error', () => {
      newLogger('ctx').error('msg');
      expect((consoleMock.error.mock.calls[0] as string[])[0]).toMatch(ISO_TIMESTAMP);
    });

    it('includes level name DEBUG', () => {
      newLogger('ctx').debug('msg');
      expect((consoleMock.debug.mock.calls[0] as string[])[0]).toContain('DEBUG');
    });

    it('includes level name INFO', () => {
      newLogger('ctx').info('msg');
      expect((consoleMock.info.mock.calls[0] as string[])[0]).toContain('INFO');
    });

    it('includes level name WARN', () => {
      newLogger('ctx').warn('msg');
      expect((consoleMock.warn.mock.calls[0] as string[])[0]).toContain('WARN');
    });

    it('includes level name ERROR', () => {
      newLogger('ctx').error('msg');
      expect((consoleMock.error.mock.calls[0] as string[])[0]).toContain('ERROR');
    });

    it('includes the context name', () => {
      newLogger('my-module').info('msg');
      expect((consoleMock.info.mock.calls[0] as string[])[0]).toContain('[my-module]');
    });

    it('includes the message text', () => {
      newLogger('ctx').info('hello world');
      expect((consoleMock.info.mock.calls[0] as string[])[0]).toContain('hello world');
    });

    it('forwards additional arguments after the formatted string', () => {
      const extra = { key: 'value' };
      newLogger('ctx').info('msg', extra);
      expect(consoleMock.info.mock.calls[0]).toHaveLength(2);
      expect(consoleMock.info.mock.calls[0][1]).toEqual(extra);
    });

    it('forwards multiple additional arguments', () => {
      newLogger('ctx').error('err', 'a', 'b', { x: 1 });
      expect(consoleMock.error.mock.calls[0]).toHaveLength(4);
    });

    it('routes each level to the correct console method', () => {
      const log = newLogger('ctx');
      log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
      expect(consoleMock.debug).toHaveBeenCalledTimes(1);
      expect(consoleMock.info).toHaveBeenCalledTimes(1);
      expect(consoleMock.warn).toHaveBeenCalledTimes(1);
      expect(consoleMock.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLoggerFactory', () => {
    it('replaces the factory for loggers created after the call', () => {
      const customInfo: jest.Mock = jest.fn();
      const factory: LoggerFactory = (_ctx) => ({
        debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
        info: customInfo as any,
      });

      setLoggerFactory(factory);
      newLogger('ctx').info('hello');

      expect(customInfo).toHaveBeenCalledWith('hello');
      // Default ConsoleLogger must not have been called
      expect(consoleMock.info).not.toHaveBeenCalled();
    });

    it('takes effect immediately for loggers created before the call', () => {
      // Simulate SDK module-load-time logger creation
      const log = newLogger('ctx');

      const customInfo: jest.Mock = jest.fn();
      setLoggerFactory((_ctx) => ({
        debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
        info: customInfo as any,
      }));

      log.info('after swap');

      expect(customInfo).toHaveBeenCalledWith('after swap');
      expect(consoleMock.info).not.toHaveBeenCalled();
    });

    it('passes the context string to the factory', () => {
      const factoryFn = jest.fn().mockReturnValue({
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
      });

      setLoggerFactory(factoryFn as unknown as LoggerFactory);
      newLogger('my-module').info('x');

      expect(factoryFn).toHaveBeenCalledWith('my-module');
    });

    it('returns distinct instances for different contexts', () => {
      const instances: Logger[] = [];
      setLoggerFactory((_ctx) => {
        const inst = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        instances.push(inst);
        return inst;
      });

      newLogger('a').info('x');
      newLogger('b').info('x');

      expect(instances).toHaveLength(2);
      expect(instances[0]).not.toBe(instances[1]);
    });
  });
});
