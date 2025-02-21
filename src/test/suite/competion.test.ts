// Copyright Cedar Contributors
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

  test('validate principal.p1.', () => {
    const parts = splitPropertyChain('principal.p1.');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal["p1"].', () => {
    const parts = splitPropertyChain('principal["p1"].');
    assert.deepEqual(parts, ['principal', 'p1']);
  });

  test('validate principal["p1"].p2.', () => {
    const parts = splitPropertyChain('principal["p1"].p2.');
    assert.deepEqual(parts, ['principal', 'p1', 'p2']);
  });

  test('validate principal["some"]["nested"]["attribute"]', () => {
    const parts = splitPropertyChain(
      'principal["some"]["nested"]["attribute"]'
    );
    assert.deepEqual(parts, ['principal', 'some', 'nested', 'attribute']);
  });

  test('validate principal["some"].nested["attribute"]', () => {
    const parts = splitPropertyChain('principal["some"].nested["attribute"]');
    assert.deepEqual(parts, ['principal', 'some', 'nested', 'attribute']);
  });

  test('validate principal has some.nested.attribute', () => {
    const parts = splitPropertyChain('principal has some.nested.attribute');
    assert.deepEqual(parts, ['principal', 'some', 'nested', 'attribute']);
  });

  test('validate context.a.b.c', () => {
    const parts = splitPropertyChain('context.a.b.c');
    assert.deepEqual(parts, ['context', 'a', 'b', 'c']);
  });
});
