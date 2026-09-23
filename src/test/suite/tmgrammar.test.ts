// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import {
  CEDAR,
  CEDARSCHEMA,
  assertNotScope,
  assertScope,
  assertUnscoped,
  policy,
  tokenize,
} from './tmgrammar';

/*
 * Tokenization tests for syntaxes/cedar.tmLanguage.json and
 * syntaxes/cedarschema.tmLanguage.json. Each case names the finding it covers
 * from the cross-implementation comparison of the Prism, highlight.js and
 * VS Code grammars.
 */

suite('Cedar policy TextMate Suite', () => {
  test('P1 methods require a receiver dot', async () => {
    await assertScope(
      CEDAR,
      policy('context.s.contains("a")'),
      'contains',
      'entity.name.function'
    );
    await assertScope(
      CEDAR,
      policy('resource.getTag("w")'),
      'getTag',
      'entity.name.function'
    );
    await assertScope(
      CEDAR,
      policy('ip("1.1.1.1").isInRange(ip("1.1.1.1/24"))'),
      'isInRange',
      'entity.name.function'
    );
    // a bare call is an ExtFun call, not a method call
    await assertUnscoped(CEDAR, policy('contains("a")'), 'contains');
    // the same word used as an attribute is not a method
    await assertUnscoped(CEDAR, policy('context.contains == 1'), 'contains');
  });

  test('P1 extension constructors', async () => {
    for (const fn of ['ip', 'decimal', 'datetime', 'duration']) {
      await assertScope(
        CEDAR,
        policy(`${fn}("x")`),
        fn,
        'support.function'
      );
    }
  });

  test('P2 integer literals', async () => {
    await assertScope(CEDAR, policy('context.a == 42'), '42', 'constant.numeric');
    // leading zeros are a single INT per the grammar
    await assertScope(CEDAR, policy('context.a == 007'), '007', 'constant.numeric');
    // the sign is an operator, not part of the literal
    await assertScope(CEDAR, policy('context.a == -42'), '-', 'keyword.operator');
    await assertScope(CEDAR, policy('context.a == -42'), '42', 'constant.numeric');
    // Cedar has no digit separators
    await assertUnscoped(CEDAR, policy('context.a == 1_000'), '1_000');
    // digits inside an identifier are not numbers
    await assertUnscoped(CEDAR, policy('context.i18n == 1'), 'i18n');
  });

  test('P3 unary ! is an operator', async () => {
    await assertScope(CEDAR, policy('!true'), '!', 'keyword.operator');
    await assertScope(
      CEDAR,
      policy('!(principal in Group::"g")'),
      '!',
      'keyword.operator'
    );
    await assertScope(CEDAR, policy('context.a != 1'), '!=', 'keyword.operator');
  });

  test('P4 symbolic operators are scoped', async () => {
    const operators = [
      '&&',
      '||',
      '==',
      '!=',
      '>=',
      '<=',
      '>',
      '<',
      '+',
      '-',
      '*',
    ];
    for (const op of operators) {
      await assertScope(
        CEDAR,
        policy(`context.a ${op} 1`),
        op,
        'keyword.operator'
      );
    }
  });

  test('P4 symbolic operators without surrounding whitespace', async () => {
    await assertScope(CEDAR, policy('true&&false'), '&&', 'keyword.operator');
    await assertScope(CEDAR, policy('context.a==1'), '==', 'keyword.operator');
    await assertScope(CEDAR, policy('context.a+1>2'), '+', 'keyword.operator');
    await assertScope(CEDAR, policy('context.a+1>2'), '>', 'keyword.operator');
  });

  test('P5 annotations, including the valueless form', async () => {
    // meta.decorator alone is not coloured by any bundled VS Code theme, so the
    // name also carries entity.name.function.decorator. That is what lets the
    // TextMate grammar stand on its own without a semantic token provider,
    // which matters inside markdown ```cedar blocks where none runs.
    for (const scope of ['meta.decorator', 'entity.name.function.decorator']) {
      await assertScope(CEDAR, `@id("x")\n${policy('true')}`, '@id', scope);
      await assertScope(
        CEDAR,
        `@doNotOptimize\n${policy('true')}`,
        '@doNotOptimize',
        scope
      );
      // ANYIDENT, so a reserved word is a legal annotation name
      await assertScope(CEDAR, `@is("x")\n${policy('true')}`, '@is', scope);
      await assertScope(
        CEDAR,
        `@__cedar("x")\n${policy('true')}`,
        '@__cedar',
        scope
      );
    }
    // a '@' inside a string is not an annotation
    await assertScope(
      CEDAR,
      policy('context.a == "@notAnAnnotation"'),
      '@notAnAnnotation',
      'string.quoted'
    );
    await assertNotScope(
      CEDAR,
      policy('context.a == "@notAnAnnotation"'),
      '@notAnAnnotation',
      'meta.decorator'
    );
  });

  test('P6 an unqualified type after is', async () => {
    await assertScope(
      CEDAR,
      'permit (principal is User, action, resource);',
      'User',
      'entity.name.type'
    );
    await assertScope(
      CEDAR,
      'permit (principal is A::User, action, resource);',
      'A::User',
      'entity.name.type'
    );
    await assertScope(CEDAR, policy('resource is Photo'), 'Photo', 'entity.name.type');
  });

  test('P7 entity literals', async () => {
    await assertScope(
      CEDAR,
      policy('principal == User::"alice"'),
      'User',
      'entity.name.type'
    );
    await assertScope(
      CEDAR,
      policy('principal == A::B::User::"a"'),
      'A::B::User',
      'entity.name.type'
    );
  });

  test('P8 word operators and control flow are scoped apart', async () => {
    await assertScope(CEDAR, policy('if true then 1 else 2'), 'if', 'keyword.control');
    await assertScope(
      CEDAR,
      policy('if true then 1 else 2'),
      'then',
      'keyword.control'
    );
    await assertScope(
      CEDAR,
      policy('if true then 1 else 2'),
      'else',
      'keyword.control'
    );
    await assertScope(CEDAR, policy('principal in A::"b"'), 'in', 'keyword.operator');
    await assertScope(CEDAR, policy('principal has x'), 'has', 'keyword.operator');
    await assertScope(
      CEDAR,
      policy('resource.n like "a*"'),
      'like',
      'keyword.operator'
    );
    for (const kw of ['permit', 'when']) {
      await assertScope(
        CEDAR,
        'permit (principal, action, resource)\nwhen { true };',
        kw,
        'keyword.control'
      );
    }
    await assertScope(
      CEDAR,
      'forbid (principal, action, resource)\nunless { true };',
      'forbid',
      'keyword.control'
    );
    await assertScope(
      CEDAR,
      'forbid (principal, action, resource)\nunless { true };',
      'unless',
      'keyword.control'
    );
  });

  test('P9 variables, template slots and booleans', async () => {
    for (const v of ['principal', 'action', 'resource']) {
      await assertScope(
        CEDAR,
        'permit (principal, action, resource);',
        v,
        'variable.language'
      );
    }
    await assertScope(CEDAR, policy('context.a == 1'), 'context', 'variable.language');
    await assertScope(
      CEDAR,
      'permit (principal in ?principal, action, resource);',
      '?principal',
      'variable.parameter'
    );
    await assertScope(
      CEDAR,
      'permit (principal, action, resource in ?resource);',
      '?resource',
      'variable.parameter'
    );
    await assertScope(CEDAR, policy('true'), 'true', 'constant.language.boolean');
    await assertScope(CEDAR, policy('false'), 'false', 'constant.language.boolean');
  });

  test('P11 a string does not run past the end of a line', async () => {
    const source =
      'permit (principal, action, resource)\n' +
      'when { context.a == "unterminated };\n' +
      'permit (principal, action, resource);';
    // the policy on the following line is still tokenized as Cedar
    await assertScope(CEDAR, source, 'permit', 'keyword.control');
    const strings = (await tokenize(CEDAR, source)).filter((t) =>
      t.scopes.some((s) => s.startsWith('string.quoted'))
    );
    assert.equal(
      strings.every((t) => !t.text.includes('permit')),
      true,
      'the unterminated string should not swallow the next line'
    );
  });

  test('P11 escape sequences', async () => {
    await assertScope(
      CEDAR,
      policy('context.a == "a\\nb"'),
      '\\n',
      'constant.character.escape'
    );
    await assertScope(
      CEDAR,
      policy('context.a == "a\\x41b"'),
      '\\x41',
      'constant.character.escape'
    );
    await assertScope(
      CEDAR,
      policy('context.a == "a\\u{1F600}b"'),
      '\\u{1F600}',
      'constant.character.escape'
    );
    // PAT allows \* as an extra escape
    await assertScope(
      CEDAR,
      policy('resource.n like "a\\*b"'),
      '\\*',
      'constant.character.escape'
    );
    // an escape Cedar does not define is flagged rather than shown as valid
    await assertScope(
      CEDAR,
      policy('context.a == "a\\qb"'),
      '\\q',
      'invalid.illegal'
    );
  });

  test('P13 punctuation', async () => {
    await assertScope(
      CEDAR,
      policy('principal == A::User::"u"'),
      '::',
      'punctuation.separator.namespace'
    );
    await assertScope(
      CEDAR,
      policy('context.a == 1'),
      '.',
      'punctuation.accessor'
    );
    await assertScope(
      CEDAR,
      'permit (principal, action, resource);',
      ',',
      'punctuation.separator.comma'
    );
    await assertScope(
      CEDAR,
      'permit (principal, action, resource);',
      ';',
      'punctuation.terminator'
    );
    await assertScope(
      CEDAR,
      'permit (principal, action, resource);',
      '(',
      'punctuation.section.brackets'
    );
    // the receiver dot and the opening paren of a call are scoped too, rather
    // than being silently consumed by the method and function rules
    await assertScope(
      CEDAR,
      policy('context.s.contains("a")'),
      '.',
      'punctuation.accessor'
    );
    await assertScope(
      CEDAR,
      policy('context.s.contains("a")'),
      '(',
      'punctuation.section.brackets'
    );
    await assertScope(
      CEDAR,
      policy('ip("1.1.1.1")'),
      '(',
      'punctuation.section.brackets'
    );
  });

  test('comments', async () => {
    await assertScope(
      CEDAR,
      '// hello\npermit (principal, action, resource);',
      '// hello',
      'comment.line'
    );
    // a comment directly after a path separator
    await assertScope(
      CEDAR,
      `${policy('A::B::User::"u" == principal')}//y`,
      '//y',
      'comment.line'
    );
    // a url inside a string is not a comment
    await assertScope(
      CEDAR,
      policy('context.a == "https://x.com"'),
      'https://x.com',
      'string.quoted'
    );
    // '//' inside a string is not a comment
    await assertScope(
      CEDAR,
      policy('context.a == "// not a comment"'),
      '// not a comment',
      'string.quoted'
    );
  });
});

suite('Cedar schema TextMate Suite', () => {
  test('S1 tags does not require a preceding brace', async () => {
    await assertScope(
      CEDARSCHEMA,
      'entity E { a: String } tags String;',
      'tags',
      'keyword'
    );
    await assertScope(CEDARSCHEMA, 'entity A tags String;', 'tags', 'keyword');
    await assertScope(
      CEDARSCHEMA,
      'entity B in [P] tags Set<String>;',
      'tags',
      'keyword'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity C in P tags Set<Set<String>>;',
      'tags',
      'keyword'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity R tags { note: String };',
      'tags',
      'keyword'
    );
  });

  test('S1 tags used as a name is not the keyword', async () => {
    await assertNotScope(CEDARSCHEMA, 'entity D { tags: Bool };', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'entity D { tags?: Bool };', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'entity tags;', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'entity E, tags;', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'type tags = Long;', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'type X = { a: tags };', 'tags', 'keyword');
    await assertNotScope(CEDARSCHEMA, 'entity tags in Parent;', 'tags', 'keyword');
    await assertNotScope(
      CEDARSCHEMA,
      'action tags appliesTo { context: {} };',
      'tags',
      'keyword'
    );
  });

  test('S2 enum', async () => {
    await assertScope(
      CEDARSCHEMA,
      'entity Color enum ["Red", "Blue"];',
      'enum',
      'keyword'
    );
    await assertNotScope(CEDARSCHEMA, 'entity T { enum: Color };', 'enum', 'keyword');
  });

  test('S3 in does not require a bracketed list', async () => {
    await assertScope(CEDARSCHEMA, 'entity Photo in Album;', 'in', 'keyword');
    await assertScope(CEDARSCHEMA, 'entity Photo in [Album];', 'in', 'keyword');
    await assertScope(CEDARSCHEMA, 'action view in Action::"read";', 'in', 'keyword');
  });

  test('S4 declarations are not anchored to the start of a line', async () => {
    await assertScope(CEDARSCHEMA, 'entity User;', 'entity', 'keyword.control');
    await assertScope(CEDARSCHEMA, '  entity User;', 'entity', 'keyword.control');
    await assertScope(
      CEDARSCHEMA,
      'namespace N { entity User; }',
      'entity',
      'keyword.control'
    );
    await assertScope(
      CEDARSCHEMA,
      'namespace N { action x; }',
      'action',
      'keyword.control'
    );
    await assertScope(
      CEDARSCHEMA,
      'namespace N { type T = Long; }',
      'type',
      'keyword.control'
    );
  });

  test('S5 a namespace name is a Path', async () => {
    await assertScope(
      CEDARSCHEMA,
      'namespace Foo {\n entity E;\n}',
      'Foo',
      'entity.name.namespace'
    );
    await assertScope(
      CEDARSCHEMA,
      'namespace Foo::Bar::Baz {\n entity E;\n}',
      'Foo::Bar::Baz',
      'entity.name.namespace'
    );
  });

  test('S6 schema annotations', async () => {
    // as in the policy grammar, the name carries a themed scope as well as the
    // meta wrapper, so no semantic token provider is required
    await assertScope(
      CEDARSCHEMA,
      '@doc("ns")\nnamespace N { entity E; }',
      '@doc',
      'entity.name.function.decorator'
    );
    await assertScope(
      CEDARSCHEMA,
      '@doc("ns")\nnamespace N { entity E; }',
      '@doc',
      'meta.decorator'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity E { @doc("a") "id": Long };',
      '@doc',
      'meta.decorator'
    );
    await assertScope(CEDARSCHEMA, '@doc("t")\ntype T = Long;', '@doc', 'meta.decorator');
    await assertScope(CEDARSCHEMA, '@internal\nentity E;', '@internal', 'meta.decorator');
  });

  test('S7 built-in type names', async () => {
    await assertScope(CEDARSCHEMA, 'entity E { l: Long };', 'Long', 'support.type');
    await assertScope(CEDARSCHEMA, 'entity E { b: Bool };', 'Bool', 'support.type');
    await assertScope(
      CEDARSCHEMA,
      'entity E { s: Set<String> };',
      'Set',
      'support.type'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity E { s: Set<String> };',
      'String',
      'support.type'
    );
    await assertScope(CEDARSCHEMA, 'entity E { ip: ipaddr };', 'ipaddr', 'support.type');
    await assertScope(CEDARSCHEMA, 'type Alias = Long;', 'Long', 'support.type');
    await assertScope(CEDARSCHEMA, 'entity A tags String;', 'String', 'support.type');
  });

  test('S7 extension types, which no longer get a semantic token', async () => {
    // parseCedarSchemaCedarDoc used to push a 'function' semantic token for
    // these; the grammar is now the only thing scoping them, so assert each one.
    for (const ext of ['ipaddr', 'decimal', 'datetime', 'duration']) {
      await assertScope(
        CEDARSCHEMA,
        `entity E { a: ${ext} };`,
        ext,
        'support.type'
      );
      await assertScope(
        CEDARSCHEMA,
        `type T = Set<${ext}>;`,
        ext,
        'support.type'
      );
    }
  });

  test('S7 a declared name that collides with a reserved type name', async () => {
    await assertNotScope(
      CEDARSCHEMA,
      'entity String { a: Long };',
      'String',
      'support.type'
    );
    await assertNotScope(
      CEDARSCHEMA,
      'type ipaddr = { a: Long };',
      'ipaddr',
      'support.type'
    );
    // a common type reference is not a built-in type
    await assertNotScope(
      CEDARSCHEMA,
      'entity E { p: Primitives };',
      'Primitives',
      'support.type'
    );
  });

  test('S8 assignment and Set brackets', async () => {
    await assertScope(
      CEDARSCHEMA,
      'type T = { a: Long };',
      '=',
      'keyword.operator.assignment'
    );
    await assertScope(CEDARSCHEMA, 'entity E { s: Set<String> };', '<', 'punctuation');
    await assertScope(CEDARSCHEMA, 'entity E { s: Set<String> };', '>', 'punctuation');
  });

  test('S11 appliesTo requires a following brace', async () => {
    await assertScope(
      CEDARSCHEMA,
      'action a appliesTo { principal: [U] };',
      'appliesTo',
      'keyword'
    );
    await assertNotScope(
      CEDARSCHEMA,
      'entity E { appliesTo: Bool };',
      'appliesTo',
      'keyword'
    );
  });

  test('S12 quoted attribute names are properties', async () => {
    await assertScope(
      CEDARSCHEMA,
      'type T = { "id": Long };',
      '"id"',
      'variable.other.property'
    );
    await assertScope(
      CEDARSCHEMA,
      'type T = { "owner info": String };',
      '"owner info"',
      'variable.other.property'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity E { a?: Long };',
      'a',
      'variable.other.property'
    );
    // an ordinary string is still a string, even with a colon in it
    await assertScope(
      CEDARSCHEMA,
      '@doc("id: the task id")\nentity E;',
      'id: the task id',
      'string.quoted'
    );
    await assertScope(CEDARSCHEMA, 'action "x";', 'x', 'string.quoted');
  });

  test('S13 a comment after a path separator', async () => {
    await assertScope(CEDARSCHEMA, 'entity E { a: N::T };//c', '//c', 'comment.line');
  });

  test('S14 namespaced entity types', async () => {
    await assertScope(
      CEDARSCHEMA,
      'action a appliesTo { principal: [N2::E] };',
      'N2::E',
      'entity.name.type'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity E in [Foo::Bar::Baz];',
      'Foo::Bar::Baz',
      'entity.name.type'
    );
    await assertScope(
      CEDARSCHEMA,
      'entity E { g: Set<__cedar::String> };',
      '__cedar::String',
      'entity.name.type'
    );
  });

  test('a string does not run past the end of a line', async () => {
    const source = 'entity E { a: "unterminated };\nentity F;';
    await assertScope(CEDARSCHEMA, source, 'entity', 'keyword.control');
    const strings = (await tokenize(CEDARSCHEMA, source)).filter((t) =>
      t.scopes.some((s) => s.startsWith('string.quoted'))
    );
    assert.equal(
      strings.every((t) => !t.text.includes('entity F')),
      true
    );
  });
});
