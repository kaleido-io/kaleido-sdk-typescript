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


import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { getErrorMessage, fatalError } from './errors';

describe('errors', () => {
    it('should get error message from Error object', () => {
        const error = new Error('test error');
        const message = getErrorMessage(error);
        expect(message).toBe('test error');
    });

    it('should get error message from string', () => {
        const message = getErrorMessage('test error');
        expect(message).toBe('test error');
    });
});

describe('fatalError', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('exits with code 1 on Error', () => {
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: string | number | null) => never);
        fatalError(new Error('boom'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with code 1 on string error', () => {
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: string | number | null) => never);
        fatalError('something went wrong');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});