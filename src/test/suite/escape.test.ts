// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { before } from 'mocha';

import { addEntitiesJSON, addTestsJSON } from '../../completionjson';
import { createDiagnosticCollection } from '../../diagnostics';
import { CedarTest } from '../../validate';

/*
 * A Cedar schema allows any string as an action id or an attribute name, so
 * those have to survive both JSON and snippet escaping to produce a usable
 * Cedar entities or Cedar tests file.
 */

const ACTION_ID = 'Weird::Action::"back\\slash\"quote"';

const openEscape = async (filename: string): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', 'escape', filename),
  );

// insert a snippet by picking `label` from the "Add Cedar ..." quick pick
const addByQuickPick = async (
  filename: string,
  label: string,
  add: (
    textEditor: vscode.TextEditor,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) => Promise<boolean>,
): Promise<string> => {
  const doc = await openEscape(filename);
  const textEditor = await vscode.window.showTextDocument(doc);
  const diagnosticCollection = createDiagnosticCollection();
  const showQuickPick = vscode.window.showQuickPick;

  try {
    (vscode.window as any).showQuickPick = async (
      items: vscode.QuickPickItem[],
    ) => items.find((item) => item.label === label);

    assert.equal(await add(textEditor, diagnosticCollection), true);

    return doc.getText();
  } finally {
    (vscode.window as any).showQuickPick = showQuickPick;
    diagnosticCollection.dispose();
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
};

suite('Cedar Escape Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('add Cedar test escapes an action id and context attributes', async () => {
    const text = await addByQuickPick(
      'add.cedartests.json',
      ACTION_ID,
      addTestsJSON,
    );

    const tests: CedarTest[] = JSON.parse(text);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].request?.action, ACTION_ID);
    // the action id is also valid Cedar in the policy used to narrow the
    // principal and resource entity types
    assert.equal(tests[0].request?.principal, 'Weird::User::""');
    assert.equal(tests[0].request?.resource, 'Weird::Thing::""');
    assert.deepEqual(Object.keys(tests[0].request?.context ?? {}), [
      'ctx"quote',
      'ctx\\slash',
    ]);
  });

  test('add Cedar entity escapes attribute names', async () => {
    const text = await addByQuickPick(
      'add.cedarentities.json',
      'Weird::User',
      addEntitiesJSON,
    );

    const entities = JSON.parse(text);
    assert.equal(entities.length, 1);
    assert.deepEqual(entities[0].uid, { type: 'Weird::User', id: '' });
    assert.deepEqual(Object.keys(entities[0].attrs), [
      'quote"attr',
      'back\\slash',
      'dollar$brace}',
      'comma,pipe|',
    ]);
  });
});
