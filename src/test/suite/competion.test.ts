// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import { splitPropertyChain } from '../../completion';

suite('splitPropertyChain Suite', () => {
  test('validate principal.p1', () => {
    const parts = splitPropertyChain('principal.p1');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal.p1.p2', () => {
    const parts = splitPropertyChain('principal.p1.p2');
    assert.deepEqual(parts, ['principal', 'p1', 'p2']);
  });

  test('validate principal["p1"]', () => {
    const parts = splitPropertyChain('principal["p1"]');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal["p1"].p2', () => {
    const parts = splitPropertyChain('principal["p1"].p2');
    assert.deepEqual(parts, ['principal', 'p1', 'p2']);
  });

  test('validate principal.p1', () => {
    const parts = splitPropertyChain('principal.p1.');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal["p1"].', () => {
    const parts = splitPropertyChain('principal["p1"].');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal["p1"].p2', () => {
    const parts = splitPropertyChain('principal["p1"].p2.');
    assert.deepEqual(parts, ['principal', 'p1', 'p2']);
  });
});
