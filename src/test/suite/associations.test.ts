// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { after, before } from 'mocha';

import {
  cedarKindGlob,
  detectEntitiesDoc,
  detectSchemaDoc,
  detectTestsDoc,
  determineCedarKind,
  getCedarTestFiles,
} from '../../fileutil';
import { parseTestsDocText } from '../../validate';
import { evaluateTest, gatherTestRun } from '../../testing';

const openNonstandard = async (
  filename: string,
): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', 'nonstandard', filename),
  );

const setFileAssociations = async (
  value: Record<string, string> | undefined,
) => {
  await vscode.workspace
    .getConfiguration('cedar')
    .update('fileAssociations', value, vscode.ConfigurationTarget.Global);
};

suite('Cedar File Associations Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  after(async () => {
    await setFileAssociations(undefined);
  });

  test('non-standard names are not Cedar files by default', async () => {
    await setFileAssociations(undefined);

    for (const filename of ['schema.json', 'entities.json', 'tests.json']) {
      const doc = await openNonstandard(filename);
      assert.equal(determineCedarKind(doc), undefined, filename);
    }

    const testsDoc = await openNonstandard('tests.json');
    assert.equal(detectSchemaDoc(testsDoc), false);
    assert.equal(detectEntitiesDoc(testsDoc), false);
    assert.equal(detectTestsDoc(testsDoc), false);
  });

  test('cedar.fileAssociations determines the Cedar kind', async () => {
    await setFileAssociations({
      'schema.json': 'cedarschema.json',
      'entities.json': 'cedarentities',
      'tests.json': 'cedartests',
    });

    const schemaDoc = await openNonstandard('schema.json');
    assert.equal(determineCedarKind(schemaDoc), 'cedarschema.json');
    assert.equal(detectSchemaDoc(schemaDoc), true);

    const entitiesDoc = await openNonstandard('entities.json');
    assert.equal(determineCedarKind(entitiesDoc), 'cedarentities');
    assert.equal(detectEntitiesDoc(entitiesDoc), true);

    const testsDoc = await openNonstandard('tests.json');
    assert.equal(determineCedarKind(testsDoc), 'cedartests');
    assert.equal(detectTestsDoc(testsDoc), true);
  });

  test('built-in filenames take precedence over an association', async () => {
    await setFileAssociations({ '*.json': 'cedarentities' });

    const testsDoc = await vscode.workspace.openTextDocument(
      path.join(process.cwd(), 'testdata', 'photoapp', 'cedartests.json'),
    );
    assert.equal(determineCedarKind(testsDoc), 'cedartests');
  });

  test('a glob pattern matches a folder of Cedar files', async () => {
    await setFileAssociations({ 'nonstandard/*.json': 'cedartests' });

    const testsDoc = await openNonstandard('tests.json');
    assert.equal(determineCedarKind(testsDoc), 'cedartests');
  });

  test('document selector globs include the associations', async () => {
    await setFileAssociations({ 'tests.json': 'cedartests' });

    const glob = cedarKindGlob('cedartests');
    assert.ok(glob.includes('**/cedartests.json'), glob);
    assert.ok(glob.includes('**/tests.json'), glob);

    const selector = { language: 'json', pattern: glob };
    const testsDoc = await openNonstandard('tests.json');
    assert.ok(vscode.languages.match(selector, testsDoc) > 0);
  });

  test('related Cedar files are discovered by association', async () => {
    await setFileAssociations({
      'schema.json': 'cedarschema.json',
      'entities.json': 'cedarentities',
      'links.json': 'cedartemplatelinks',
      'tests.json': 'cedartests',
    });

    const testsDoc = await openNonstandard('tests.json');
    const { schemaDoc, policyDocs, templateLinksDoc, entitiesDoc } =
      await getCedarTestFiles(testsDoc);

    assert.ok(schemaDoc?.uri.fsPath.endsWith('schema.json'));
    assert.equal(policyDocs.length, 1);
    assert.ok(templateLinksDoc?.uri.fsPath.endsWith('links.json'));
    assert.ok(entitiesDoc?.uri.fsPath.endsWith('entities.json'));
  });

  test('tests in an associated file are evaluated', async () => {
    await setFileAssociations({
      'schema.json': 'cedarschema.json',
      'entities.json': 'cedarentities',
      'links.json': 'cedartemplatelinks',
      'tests.json': 'cedartests',
    });

    const testsDoc = await openNonstandard('tests.json');
    const tests = parseTestsDocText(testsDoc, []);
    assert.ok(tests && tests.length > 0);

    const testRun = await gatherTestRun(testsDoc);
    assert.equal(testRun.schemaIsJson, true);
    tests.forEach((test) => {
      const { failures } = evaluateTest(test, testRun);
      assert.deepEqual(failures, [], test.name);
    });
  });
});
