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

export interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

export type LoggerFactory = (context: string) => Logger;

class ConsoleLogger implements Logger {
    constructor(private context: string) { }

    private fmt(level: string, message: string): string {
        return `${new Date().toISOString()} ${level.padEnd(5)} [${this.context}] ${message}`;
    }

    debug(message: string, ...args: any[]): void {
        console.debug(this.fmt('DEBUG', message), ...args);
    }

    info(message: string, ...args: any[]): void {
        console.info(this.fmt('INFO', message), ...args);
    }

    warn(message: string, ...args: any[]): void {
        console.warn(this.fmt('WARN', message), ...args);
    }

    error(message: string, ...args: any[]): void {
        console.error(this.fmt('ERROR', message), ...args);
    }
}

export const defaultLoggerFactory: LoggerFactory = (context) => new ConsoleLogger(context);

let currentFactory: LoggerFactory = defaultLoggerFactory;

/**
 * Replace the logger factory used by all SDK modules.
 *
 * Call this at application startup to route SDK logs through your own logging
 * infrastructure. Takes effect immediately for all loggers, including those
 * already created at module-load time.
 */
export function setLoggerFactory(factory: LoggerFactory): void {
    currentFactory = factory;
}

/**
 * Create a named logger for the given context.
 *
 * Returns a late-binding proxy so that a subsequent {@link setLoggerFactory}
 * call takes effect even for loggers created before it.
 */
export function newLogger(context: string): Logger {
    let delegate: Logger = currentFactory(context);
    let knownFactory: LoggerFactory = currentFactory;

    function getDelegate(): Logger {
        if (currentFactory !== knownFactory) {
            delegate = currentFactory(context);
            knownFactory = currentFactory;
        }
        return delegate;
    }

    return {
        debug: (message, ...args) => getDelegate().debug(message, ...args),
        info:  (message, ...args) => getDelegate().info(message, ...args),
        warn:  (message, ...args) => getDelegate().warn(message, ...args),
        error: (message, ...args) => getDelegate().error(message, ...args),
    };
}
