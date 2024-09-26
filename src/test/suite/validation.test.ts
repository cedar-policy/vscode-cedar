// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AT_LINE_SCHEMA_REGEX,
  EXIST_ATTR_REGEX,
  EXPECTED_ATTR2_REGEX,
  EXPECTED_ATTR_REGEX,
  MISMATCH_ATTR_REGEX,
  NOTALLOWED_PARENT_REGEX,
  NOTDECLARED_TYPE_REGEX,
  OFFSET_POLICY_REGEX,
  UNDECLARED_REGEX,
  UNRECOGNIZED_REGEX,
} from '../../regex';

import { determineEntityTypes } from '../../validate';

const readTestDataFile = (dirname: string, filename: string): string => {
  const filepath = path.join(process.cwd(), 'testdata', dirname, filename);
  return fs.readFileSync(filepath, 'utf8');
};

suite('Validation Schema Natural Test Suite', () => {
  test('validate shadow warnings', async () => {
    const schema = readTestDataFile('shadow', 'Demo.cedarschema');
    const result: cedar.ValidateSchemaResult =
      cedar.validateSchemaNatural(schema);
    assert.equal(result.success, true);
    // The name `ipaddr` shadows a builtin Cedar name. You'll have to refer to the builtin as `__cedar::ipaddr`.
    // The name `String` shadows a builtin Cedar name. You'll have to refer to the builtin as `__cedar::String`.
    assert.equal(result.warnings?.length, 2);
  });
});

suite('Validation RegEx Test Suite', () => {
  test('validate policy error "found at"', async () => {
    const policy = readTestDataFile('notfound', 'policy.cedar');
    const result: cedar.ValidateSyntaxResult = cedar.validateSyntax(policy);
    assert.equal(result.success, false);
    assert.equal(result.errors?.length, 3);

    if (result.errors) {
      let e = result.errors[0];
      assert.ok(e.message.startsWith('unexpected token `action`'));
      assert.equal(e.offset, 18);
      assert.equal(e.length, 6);

      e = result.errors[1];
      assert.ok(e.message.startsWith('unexpected token `resource`'));
      assert.equal(e.offset, 25);
      assert.equal(e.length, 8);

      e = result.errors[2];
      assert.ok(e.message.startsWith('unexpected token `)`'));
      assert.equal(e.offset, 33);
      assert.equal(e.length, 1);
    }

    result.free();
  });

  test('validate policy error "offset"', async () => {
    const policy = readTestDataFile('offset', 'policy.cedar');
    const schema = readTestDataFile('offset', 'cedarschema.json');

    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // validation error on policy `policy0` at offset 44-53: unable to find upper bound for types: [{"type":"True"},{"type":"Long"}]
      let errorMsg: string = result.errors[0];
      let found = errorMsg.match(OFFSET_POLICY_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(parseInt(found?.groups.start), 44);
        assert.equal(parseInt(found?.groups.end), 53);
      }
    }

    result.free();
  });

  test('validate policy unrecognized entity and action type', async () => {
    const policy = readTestDataFile('unrecognized', 'policy.cedar');
    const schema = readTestDataFile('unrecognized', 'cedarschema.json');

    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    assert.equal(result.success, false);

    if (result.errors) {
      assert.equal(result.errors.length, 3);

      // validation error on policy `policy0`: unrecognized entity type `Tst`
      // Validation error on policy policy0: Unrecognized entity type Tst, did you mean Test?
      let errorMsg: string = result.errors[0];
      let found = errorMsg.match(UNRECOGNIZED_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.unrecognized, 'Tst');
        assert.equal(found?.groups.suggestion, 'Test');
      }

      errorMsg = result.errors[1];
      found = errorMsg.match(UNRECOGNIZED_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.unrecognized, 'Action::"doTst"');
        assert.equal(found?.groups.suggestion, 'Action::"doTest"');
      }
    }

    result.free();
  });

  test('validate policy schema error "at line"', async () => {
    const schema = readTestDataFile('atline', 'cedarschema.json');

    const result: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
    assert.equal(result.success, false);

    if (result.errors) {
      // JSON Schema file could not be parsed: missing field `entityTypes` at line 2 column 9
      let errorMsg: string = result.errors[0].message;
      let found = errorMsg.match(AT_LINE_SCHEMA_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(parseInt(found?.groups.line), 2);
        assert.equal(parseInt(found?.groups.column), 9);
      }
    }

    result.free();
  });

  test('validate policy schema undeclared entity type', async () => {
    const schema = readTestDataFile(
      'undeclared',
      'entitytype.cedarschema.json'
    );

    const result: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
    assert.equal(result.success, false);

    if (result.errors) {
      // undeclared entity type(s): {"Test"}
      let errorMsg: string = result.errors[0].message;
      let found = errorMsg.match(UNDECLARED_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'entity type(s)');
        assert.equal(found?.groups.undeclared, '"Test"');
      }
    }

    result.free();
  });

  test('validate policy schema undeclared actions', async () => {
    const schema = readTestDataFile('undeclared', 'actions.cedarschema.json');

    const result: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
    assert.equal(result.success, false);

    if (result.errors) {
      // Undeclared actions: {"Action::\"test1\"", "Action::\"test2\""}
      let errorMsg: string = result.errors[0].message;
      let found = errorMsg.match(UNDECLARED_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'action(s)');
        const actions = found?.groups.undeclared.split(', ');
        assert.equal(actions.includes('"Action::\\"test1\\""'), true);
        assert.equal(actions.includes('"Action::\\"test2\\""'), true);
      }
    }

    result.free();
  });

  test('validate entity expected attributes', async () => {
    const entities = readTestDataFile(
      'entityattr',
      'expected.cedarentities.json'
    );
    const schema = readTestDataFile('entityattr', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // entity does not conform to the schema: expected entity `Test::"expected"` to have attribute `test`, but it does not
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('entity does not conform to the schema: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'expected entity `Test::"expected"` to have attribute `test`, but it does not'
      );
      let found = errorMsg.match(EXPECTED_ATTR_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Test');
        assert.equal(found?.groups.id, 'expected');
        assert.equal(found?.groups.suggestion, 'test');
      }
    }

    result.free();
  });

  test('validate entity expected nested attributes', async () => {
    const entities = readTestDataFile(
      'entityattr',
      'expected2.cedarentities.json'
    );
    const schema = readTestDataFile('entityattr', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // error during entity deserialization: in attribute `nested` on `Test::"expected"`, expected the record to have an attribute `test`, but it does not
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('error during entity deserialization: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'in attribute `nested` on `Test::"expected"`, expected the record to have an attribute `test`, but it does not'
      );
      let found = errorMsg.match(EXPECTED_ATTR2_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Test');
        assert.equal(found?.groups.id, 'expected');
        assert.equal(found?.groups.attribute, 'nested');
        assert.equal(found?.groups.suggestion, 'test');
      }
    }

    result.free();
  });

  test('validate entity mismatch type attributes', async () => {
    const entities = readTestDataFile(
      'entityattr',
      'mismatch.cedarentities.json'
    );
    const schema = readTestDataFile('entityattr', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // entity does not conform to the schema: in attribute `test` on `Test::"mismatch"`, type mismatch: value was expected to have type string, but actually has type long: `1`
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('entity does not conform to the schema: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'in attribute `test` on `Test::"mismatch"`, type mismatch: value was expected to have type string, but actually has type long: `1`'
      );
      let found = errorMsg.match(MISMATCH_ATTR_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Test');
        assert.equal(found?.groups.id, 'mismatch');
        assert.equal(found?.groups.attribute, 'test');
      }
    }

    result.free();
  });

  test('validate entity mismatch entity type attributes', async () => {
    const entities = readTestDataFile(
      'entityattr',
      'mismatchentity.cedarentities.json'
    );
    const schema = readTestDataFile('entityattr', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // entity does not conform to the schema: in attribute `self` on `Test::"mismatchentity"`, type mismatch: value was expected to have type `Test`, but actually has type `Tst`: `Tst::"mismatchtype"`
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('entity does not conform to the schema: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'in attribute `self` on `Test::"mismatchentity"`, type mismatch: value was expected to have type `Test`, but actually has type `Tst`: `Tst::"mismatchtype"`'
      );
      let found = errorMsg.match(MISMATCH_ATTR_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Test');
        assert.equal(found?.groups.id, 'mismatchentity');
        assert.equal(found?.groups.attribute, 'self');
      }
    }

    result.free();
  });

  test('validate entity exist attributes', async () => {
    const entities = readTestDataFile('entityattr', 'exist.cedarentities.json');
    const schema = readTestDataFile('entityattr', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // error during entity deserialization: attribute `tst` on `Test::"exist"` should not exist according to the schema
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('error during entity deserialization: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'attribute `tst` on `Test::"exist"` should not exist according to the schema'
      );
      let found = errorMsg.match(EXIST_ATTR_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Test');
        assert.equal(found?.groups.id, 'exist');
        assert.equal(found?.groups.attribute, 'tst');
      }
    }

    result.free();
  });

  test('validate entity exist type', async () => {
    const entities = readTestDataFile(
      'entitytype',
      'missingnamespace.cedarentities.json'
    );
    const schema = readTestDataFile('entitytype', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // error during entity deserialization: entity `Employee::"12UA45"` has type `Employee` which is not declared in the schema`?
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('error during entity deserialization: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        'entity `Employee::"12UA45"` has type `Employee` which is not declared in the schema'
      );
      let found = errorMsg.match(NOTDECLARED_TYPE_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'Employee');
        assert.equal(found?.groups.id, '12UA45');
      }
    }

    result.free();
  });

  test('validate entity parent type', async () => {
    const entities = readTestDataFile(
      'entitytype',
      'notallowedparent.cedarentities.json'
    );
    const schema = readTestDataFile('entitytype', 'cedarschema.json');

    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      schema,
      entities
    );
    assert.equal(result.success, false);

    if (result.errors) {
      // entity does not conform to the schema: `XYZCorp::Employee::"12UA45"` is not allowed to have an ancestor of type `XYZCorp::Employee` according to the schema
      let errorMsg: string = result.errors[0];
      assert.ok(errorMsg.startsWith('entity does not conform to the schema: '));
      errorMsg = errorMsg.substring(errorMsg.indexOf(': ') + 2);
      assert.equal(
        errorMsg,
        '`XYZCorp::Employee::"12UA45"` is not allowed to have an ancestor of type `XYZCorp::Employee` according to the schema'
      );
      let found = errorMsg.match(NOTALLOWED_PARENT_REGEX);
      assert(found?.groups);
      if (found?.groups) {
        assert.equal(found?.groups.type, 'XYZCorp::Employee');
        assert.equal(found?.groups.id, '12UA45');
      }
    }

    result.free();
  });
});

suite('Validate Policy Entities Test Suite', () => {
  const fetchEntityTypes = async (
    head: string
  ): Promise<{
    principals: string[];
    resources: string[];
    actions: string[];
  }> => {
    const schemaDoc = await vscode.workspace.openTextDocument(
      path.join(process.cwd(), 'testdata', 'narrow', 'cedarschema.json')
    );

    const principalTypes = determineEntityTypes(schemaDoc, 'principal', head);
    const resourceTypes = determineEntityTypes(schemaDoc, 'resource', head);
    const actionIds = determineEntityTypes(schemaDoc, 'action', head);

    return Promise.resolve({
      principals: principalTypes,
      resources: resourceTypes,
      actions: actionIds,
    });
  };

  test('validate unspecified', async () => {
    const head = `permit(principal, action, resource)`;
    const e = await fetchEntityTypes(head);

    assert.equal(e.principals.length, 2);
    assert.equal(e.principals[0], 'NS::E1');
    assert.equal(e.principals[1], 'NS::E2');

    assert.equal(e.actions.length, 3);
    assert.equal(e.actions[0], `NS::Action::"a"`);
    assert.equal(e.actions[1], `NS::Action::"a1"`);
    assert.equal(e.actions[2], `NS::Action::"a2"`);

    assert.equal(e.resources.length, 2);
    assert.equal(e.resources[0], 'NS::R1');
    assert.equal(e.resources[1], 'NS::R2');
  });

  test('validate E1 a1 R1', async () => {
    const head = `permit (principal in NS::E::"id", action == NS::Action::"a1", resource)`;
    const e = await fetchEntityTypes(head);

    assert.equal(e.principals.length, 1);
    assert.equal(e.principals[0], 'NS::E1');

    assert.equal(e.actions.length, 1);
    assert.equal(e.actions[0], `NS::Action::"a1"`);

    assert.equal(e.resources.length, 1);
    assert.equal(e.resources[0], 'NS::R1');
  });
});
