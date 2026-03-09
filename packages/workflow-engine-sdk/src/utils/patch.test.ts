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


import { describe, it, expect } from '@jest/globals';
import { apply, addOp, removeOp, replaceOp, moveOp, copyOp, testOp } from './patch';
import { PatchOpType } from '../types/core';

describe('patch', () => {
    describe('apply', () => {
        it('should return original state when patch is null', () => {
            const state = { foo: 'bar' };
            const result = apply(state, null as any);
            expect(result).toBe(state);
        });

        it('should return original state when patch is undefined', () => {
            const state = { foo: 'bar' };
            const result = apply(state, undefined as any);
            expect(result).toBe(state);
        });

        it('should return original state when patch is empty array', () => {
            const state = { foo: 'bar' };
            const result = apply(state, []);
            expect(result).toBe(state);
        });

        it('should apply add operation to root level', () => {
            const state = { foo: 'bar' };
            const patch = [addOp('/baz', 'qux')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: 'bar', baz: 'qux' });
        });

        it('should apply add operation to nested path', () => {
            const state = { foo: { bar: 'baz' } };
            const patch = [addOp('/foo/qux', 'value')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: { bar: 'baz', qux: 'value' } });
        });

        it('should apply add operation to array', () => {
            const state = { items: ['a', 'b'] };
            const patch = [addOp('/items/2', 'c')];
            const result = apply(state, patch);
            expect(result).toEqual({ items: ['a', 'b', 'c'] });
        });

        it('should apply add operation to array end', () => {
            const state = { items: ['a', 'b'] };
            const patch = [addOp('/items/-', 'c')];
            const result = apply(state, patch);
            expect(result).toEqual({ items: ['a', 'b', 'c'] });
        });

        it('should apply remove operation', () => {
            const state = { foo: 'bar', baz: 'qux' };
            const patch = [removeOp('/foo')];
            const result = apply(state, patch);
            expect(result).toEqual({ baz: 'qux' });
        });

        it('should apply remove operation to nested path', () => {
            const state = { foo: { bar: 'baz', qux: 'value' } };
            const patch = [removeOp('/foo/bar')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: { qux: 'value' } });
        });

        it('should apply remove operation to array element', () => {
            const state = { items: ['a', 'b', 'c'] };
            const patch = [removeOp('/items/1')];
            const result = apply(state, patch);
            expect(result).toEqual({ items: ['a', 'c'] });
        });

        it('should apply replace operation', () => {
            const state = { foo: 'bar' };
            const patch = [replaceOp('/foo', 'baz')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: 'baz' });
        });

        it('should apply replace operation to nested path', () => {
            const state = { foo: { bar: 'baz' } };
            const patch = [replaceOp('/foo/bar', 'qux')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: { bar: 'qux' } });
        });

        it('should apply move operation', () => {
            const state = { foo: { bar: 'baz' } };
            const patch = [moveOp('/foo/bar', '/qux')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: {}, qux: 'baz' });
        });

        it('should apply copy operation', () => {
            const state = { foo: { bar: 'baz' } };
            const patch = [copyOp('/foo/bar', '/qux')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: { bar: 'baz' }, qux: 'baz' });
        });

        it('should apply test operation successfully when value matches', () => {
            const state = { foo: 'bar' };
            const patch = [testOp('/foo', 'bar')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: 'bar' });
        });

        it('should apply multiple operations in sequence', () => {
            const state = { foo: 'bar', items: ['a'] };
            const patch = [
                addOp('/baz', 'qux'),
                replaceOp('/foo', 'updated'),
                addOp('/items/1', 'b')
            ];
            const result = apply(state, patch);
            expect(result).toEqual({
                foo: 'updated',
                baz: 'qux',
                items: ['a', 'b']
            });
        });

        it('should handle complex nested operations', () => {
            const state = {
                user: {
                    name: 'John',
                    age: 30,
                    address: {
                        city: 'NYC'
                    }
                }
            };
            const patch = [
                replaceOp('/user/name', 'Jane'),
                addOp('/user/address/state', 'NY'),
                removeOp('/user/age')
            ];
            const result = apply(state, patch);
            expect(result).toEqual({
                user: {
                    name: 'Jane',
                    address: {
                        city: 'NYC',
                        state: 'NY'
                    }
                }
            });
        });

        it('should handle array operations', () => {
            const state = { items: [1, 2, 3] };
            const patch = [
                replaceOp('/items/0', 10),
                addOp('/items/-', 4),
                removeOp('/items/1')
            ];
            const result = apply(state, patch);
            expect(result).toEqual({ items: [10, 3, 4] });
        });

        it('should handle empty object state', () => {
            const state = {};
            const patch = [addOp('/foo', 'bar')];
            const result = apply(state, patch);
            expect(result).toEqual({ foo: 'bar' });
        });

        it('should handle null and undefined values', () => {
            const state = { foo: 'bar' };
            const patch = [
                addOp('/nullValue', null),
                addOp('/undefinedValue', undefined)
            ];
            const result = apply(state, patch);
            expect(result).toHaveProperty('nullValue', null);
            expect(result).toHaveProperty('undefinedValue', undefined);
        });

        it('should handle object values', () => {
            const state = { foo: 'bar' };
            const patch = [addOp('/nested', { a: 1, b: 2 })];
            const result = apply(state, patch);
            expect(result).toEqual({
                foo: 'bar',
                nested: { a: 1, b: 2 }
            });
        });

        it('should handle array values', () => {
            const state = { foo: 'bar' };
            const patch = [addOp('/items', [1, 2, 3])];
            const result = apply(state, patch);
            expect(result).toEqual({
                foo: 'bar',
                items: [1, 2, 3]
            });
        });
    });

    describe('operation creators', () => {
        describe('addOp', () => {
            it('should create add operation with path and value', () => {
                const op = addOp('/foo', 'bar');
                expect(op).toEqual({
                    op: PatchOpType.ADD,
                    path: '/foo',
                    value: 'bar'
                });
            });

            it('should create add operation with object value', () => {
                const value = { nested: 'value' };
                const op = addOp('/foo', value);
                expect(op).toEqual({
                    op: PatchOpType.ADD,
                    path: '/foo',
                    value
                });
            });
        });

        describe('removeOp', () => {
            it('should create remove operation with path', () => {
                const op = removeOp('/foo');
                expect(op).toEqual({
                    op: PatchOpType.REMOVE,
                    path: '/foo'
                });
            });

            it('should create remove operation with nested path', () => {
                const op = removeOp('/foo/bar/baz');
                expect(op).toEqual({
                    op: PatchOpType.REMOVE,
                    path: '/foo/bar/baz'
                });
            });
        });

        describe('replaceOp', () => {
            it('should create replace operation with path and value', () => {
                const op = replaceOp('/foo', 'newValue');
                expect(op).toEqual({
                    op: PatchOpType.REPLACE,
                    path: '/foo',
                    value: 'newValue'
                });
            });

            it('should create replace operation with number value', () => {
                const op = replaceOp('/count', 42);
                expect(op).toEqual({
                    op: PatchOpType.REPLACE,
                    path: '/count',
                    value: 42
                });
            });
        });

        describe('moveOp', () => {
            it('should create move operation with from and path', () => {
                const op = moveOp('/foo', '/bar');
                expect(op).toEqual({
                    op: PatchOpType.MOVE,
                    from: '/foo',
                    path: '/bar'
                });
            });

            it('should create move operation with nested paths', () => {
                const op = moveOp('/source/nested', '/target/nested');
                expect(op).toEqual({
                    op: PatchOpType.MOVE,
                    from: '/source/nested',
                    path: '/target/nested'
                });
            });
        });

        describe('copyOp', () => {
            it('should create copy operation with from and path', () => {
                const op = copyOp('/foo', '/bar');
                expect(op).toEqual({
                    op: PatchOpType.COPY,
                    from: '/foo',
                    path: '/bar'
                });
            });

            it('should create copy operation with nested paths', () => {
                const op = copyOp('/source/nested', '/target/nested');
                expect(op).toEqual({
                    op: PatchOpType.COPY,
                    from: '/source/nested',
                    path: '/target/nested'
                });
            });
        });

        describe('testOp', () => {
            it('should create test operation with path and value', () => {
                const op = testOp('/foo', 'bar');
                expect(op).toEqual({
                    op: PatchOpType.TEST,
                    path: '/foo',
                    value: 'bar'
                });
            });

            it('should create test operation with number value', () => {
                const op = testOp('/count', 42);
                expect(op).toEqual({
                    op: PatchOpType.TEST,
                    path: '/count',
                    value: 42
                });
            });
        });
    });
});
