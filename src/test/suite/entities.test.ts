// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { before } from 'mocha';

import { parseCedarEntitiesDoc } from '../../parser';

const openTestDataFile = async (
  dirname: string,
  filename: string,
): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', dirname, filename),
  );

suite('Cedar Entities Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('parse Cedar entities', async () => {
    const entitiesDoc = await openTestDataFile(
      'entityattr',
      'expected.cedarentities.json',
    );
    const { entities, referencedTypes } = parseCedarEntitiesDoc(entitiesDoc);

    assert.equal(entities.length, 1);
    assert.equal(entities[0].uid, 'Test::"expected"');
    assert.deepEqual(
      referencedTypes.map((referencedType) => referencedType.name),
      ['Test'],
    );
  });

  // Amazon Verified Permissions entities use different property names
  test('parse Amazon Verified Permissions entities', async () => {
    const entitiesDoc = await openTestDataFile('avp', 'avpentities.json');
    const { entities, referencedTypes } = parseCedarEntitiesDoc(entitiesDoc);

    assert.equal(entities.length, 1);
    assert.equal(entities[0].uid, 'PhotoApp::User::"JaneDoe"');
    assert.deepEqual(Object.keys(entities[0].attrsNameRanges), [
      'department',
      'manager',
    ]);
    assert.deepEqual(
      referencedTypes.map((referencedType) => referencedType.name),
      ['PhotoApp::User', 'PhotoApp::User', 'PhotoApp::UserGroup'],
    );
  });
});
