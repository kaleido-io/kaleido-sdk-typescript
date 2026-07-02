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


import { describe, expect, it } from '@jest/globals';
import { kidColon, kidDash } from './kidutils';

describe('kidutils', () => {
    it('should do kidColon', () => {
        expect(kidColon('s', 's-12345abcde')).toEqual('s:12345abcde')
        expect(kidColon('s', 's:12345abcde')).toEqual('s:12345abcde')
        expect(kidColon('s', 'any-thing')).toEqual('any-thing')
    });

    it('should do kidDash', () => {
        expect(kidDash('s', 's-12345abcde')).toEqual('s-12345abcde')
        expect(kidDash('s', 's:12345abcde')).toEqual('s-12345abcde')
        expect(kidDash('s', 'any:thing')).toEqual('any:thing')
    });
});