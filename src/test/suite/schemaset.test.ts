// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as path from 'node:path';
import { before } from 'mocha';

import { createDiagnosticCollection } from '../../diagnostics';
import {
  describeSchemaSet,
  getSchemaSet,
  getSchemaSetForSchemaDoc,
  isCombinedSchemaDoc,
} from '../../fileutil';
import {
  CedarDefinitionProvider,
  CedarSchemaDefinitionProvider,
} from '../../definition';
import { CedarSchemaHoverProvider } from '../../hover';
import { parseCedarPoliciesDoc, parseCedarSchemaDoc } from '../../parser';
import { evaluateTest, gatherTestRun } from '../../testing';
import {
  parseTestsDocText,
  validateCedarDoc,
  validateEntitiesDoc,
  validateSchemaFileDoc,
  validateTestsDoc,
} from '../../validate';

/*
 * Every Cedar schema file in a folder is combined into one schema, merged as
 * fragments (testdata/schemaset-merge) or linked when any of them declares an
 * `external` entity type or action (testdata/schemaset-external).
 */

const openTestData = async (
  dirname: string,
  filename: string,
): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', dirname, filename),
  );

const messages = (
  diagnosticCollection: vscode.DiagnosticCollection,
  doc: vscode.TextDocument,
): string[] => (diagnosticCollection.get(doc.uri) || []).map((d) => d.message);

const mockToken: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

suite('Cedar Schema Set Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('linkSchemas merges without external', async () => {
    const result = cedar.linkSchemas(
      ['entity User;', 'entity Doc { owner: User };'],
      ['cedar', 'cedar'],
    );
    assert.equal(result.success, true);
    assert.equal(result.mode, 'merge');
    assert.equal(result.complete, true);
    result.free();
  });

  test('linkSchemas locates a duplicate definition', async () => {
    const result = cedar.linkSchemas(
      ['entity Doc;', 'entity Other;\nentity Doc;'],
      ['cedar', 'cedar'],
    );
    assert.equal(result.success, false);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].message.includes('`Doc`'));
    assert.ok(result.errors[0].index >= 0);
    result.free();
  });

  test('linkSchemas links external, mixing Cedar and JSON', async () => {
    const result = cedar.linkSchemas(
      [
        'external entity User; entity Doc { owner: User };',
        '{"": { "entityTypes": { "User": {} }, "actions": {} } }',
      ],
      ['cedar', 'json'],
    );
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.mode, 'link');
    assert.equal(result.complete, true);
    result.free();
  });

  test('merge folder combines schema files', async () => {
    const cedarDoc = await openTestData('schemaset-merge', 'policies.cedar');
    const set = await getSchemaSet(cedarDoc);
    assert.equal(set?.docs.length, 2);
    assert.equal(set?.link?.mode, 'merge');
    assert.ok(set?.doc && isCombinedSchemaDoc(set.doc));
    // the combined schema is multiple lines for readability
    assert.ok(set.doc.lineCount > 10);
    assert.equal(
      describeSchemaSet(cedarDoc, set).title,
      'Validated using documents.cedarschema, identity.cedarschema',
    );
  });

  test('merge folder validates policies, entities, and tests', async () => {
    const diagnosticCollection = createDiagnosticCollection();
    try {
      for (const [filename, validate] of [
        ['policies.cedar', validateCedarDoc],
        ['cedarentities.json', validateEntitiesDoc],
        ['cedartests.json', validateTestsDoc],
      ] as const) {
        const doc = await openTestData('schemaset-merge', filename);
        const success = await validate(doc, diagnosticCollection, true);
        assert.equal(
          success,
          true,
          `${filename}: ${JSON.stringify(messages(diagnosticCollection, doc))}`,
        );
      }

      // a schema file which refers to types in another isn't an error
      const schemaDoc = await openTestData(
        'schemaset-merge',
        'documents.cedarschema',
      );
      assert.equal(
        await validateSchemaFileDoc(schemaDoc, diagnosticCollection, true),
        true,
      );
      assert.deepEqual(messages(diagnosticCollection, schemaDoc), []);
    } finally {
      diagnosticCollection.dispose();
    }
  });

  test('external folder links schema files', async () => {
    const cedarDoc = await openTestData('schemaset-external', 'policies.cedar');
    const set = await getSchemaSet(cedarDoc);
    assert.equal(set?.docs.length, 3);
    assert.equal(set?.link?.mode, 'link');
    assert.equal(set?.link?.complete, true);

    const diagnosticCollection = createDiagnosticCollection();
    try {
      assert.equal(
        await validateCedarDoc(cedarDoc, diagnosticCollection, true),
        true,
        JSON.stringify(messages(diagnosticCollection, cedarDoc)),
      );
    } finally {
      diagnosticCollection.dispose();
    }
  });

  test('external folder runs Cedar tests', async () => {
    const testsDoc = await openTestData(
      'schemaset-external',
      'cedartests.json',
    );
    const tests = parseTestsDocText(testsDoc, []) || [];
    const testRun = await gatherTestRun(testsDoc);
    assert.equal(tests.length, 3);
    tests.forEach((test) =>
      assert.deepEqual(evaluateTest(test, testRun).failures, [], test.name),
    );
  });

  test('definition jumps to the defining schema file', async () => {
    const cedarDoc = await openTestData('schemaset-external', 'policies.cedar');
    const referencedType = parseCedarPoliciesDoc(cedarDoc).referencedTypes.find(
      (t) => t.name === 'DocApp::User',
    );
    assert.ok(referencedType);
    const definition = await new CedarDefinitionProvider().provideDefinition(
      cedarDoc,
      referencedType.range.start,
      mockToken,
    );
    const location = definition as vscode.Location;
    // identity.cedarschema defines User, which documents.cedarschema and
    // sharing.cedarschema.json declare external
    assert.ok(location?.uri.fsPath.endsWith('identity.cedarschema'));
  });

  test('external declaration hovers and goes to its definition', async () => {
    for (const filename of [
      'documents.cedarschema',
      'sharing.cedarschema.json',
    ]) {
      const schemaDoc = await openTestData('schemaset-external', filename);
      const declaration = parseCedarSchemaDoc(schemaDoc).definitionRanges.find(
        (d) => d.external && d.etype === 'DocApp::User',
      );
      assert.ok(declaration, filename);
      const position = declaration.etypeRange.start;

      const definition =
        await new CedarSchemaDefinitionProvider().provideDefinition(
          schemaDoc,
          position,
          mockToken,
        );
      const location = definition as vscode.Location;
      assert.ok(
        location?.uri.fsPath.endsWith('identity.cedarschema'),
        filename,
      );

      const hover = await new CedarSchemaHoverProvider().provideHover(
        schemaDoc,
        position,
        mockToken,
      );
      const md = hover?.contents[0] as vscode.MarkdownString;
      assert.ok(md?.value.includes('entity User in [Team]'), filename);
      assert.ok(md?.value.includes('Defined in [identity.cedarschema]'));
    }
  });

  test('partial schema validates entities but not policies', async () => {
    const diagnosticCollection = createDiagnosticCollection();
    try {
      const cedarDoc = await openTestData(
        'schemaset-partial',
        'policies.cedar',
      );
      const set = await getSchemaSet(cedarDoc);
      assert.ok(set);
      assert.deepEqual(set.link?.externalEntityTypes, ['DocApp::User']);
      assert.equal(
        describeSchemaSet(cedarDoc, set).title,
        'Validated using documents.cedarschema (incomplete)',
      );

      await validateCedarDoc(cedarDoc, diagnosticCollection, true);
      assert.ok(
        messages(diagnosticCollection, cedarDoc).some((m) =>
          m.includes('schema is incomplete'),
        ),
      );

      const entitiesDoc = await openTestData(
        'schemaset-partial',
        'cedarentities.json',
      );
      assert.equal(
        await validateEntitiesDoc(entitiesDoc, diagnosticCollection, true),
        true,
      );
    } finally {
      diagnosticCollection.dispose();
    }
  });

  test('unrelated schema files are not a schema set', async () => {
    // no external declarations and nothing alongside them to validate
    const schemaDoc = await openTestData('reserved', 'set.cedarschema');
    assert.equal(await getSchemaSetForSchemaDoc(schemaDoc), undefined);
  });
});
