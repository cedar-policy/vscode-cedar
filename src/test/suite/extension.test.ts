// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as path from 'path';
import * as completion from '../../completion';

suite('Cedar Completion Suite', () => {
  vscode.window.showInformationMessage('Start Cedar Completion tests.');

  const mockToken: vscode.CancellationToken =
    new vscode.CancellationTokenSource().token;

  const invokeAt = async (
    position: vscode.Position,
    lastCharacter: boolean = false
  ) => {
    const doc = await vscode.workspace.openTextDocument(
      path.join(process.cwd(), 'testdata', 'triple', 'entities.cedar')
    );
    return invokeAtTextDocument(doc, position, lastCharacter);
  };

  const invokeAtTextDocument = async (
    doc: vscode.TextDocument,
    position: vscode.Position,
    lastCharacter: boolean = false
  ) => {
    await vscode.window.showTextDocument(doc);
    const provider = new completion.CedarCompletionItemProvider();
    const items = await provider.provideCompletionItems(
      doc,
      position,
      mockToken,
      lastCharacter
        ? {
            triggerKind: vscode.CompletionTriggerKind.TriggerCharacter,
            triggerCharacter: doc
              .lineAt(position.line)
              .text.substring(position.character - 1, position.character),
          }
        : {
            triggerKind: vscode.CompletionTriggerKind.Invoke,
            triggerCharacter: undefined,
          }
    );

    return items;
  };

  const triggerLastCharacter = async (
    content: string,
    lastCharacter: boolean = true
  ) => {
    const doc = await vscode.workspace.openTextDocument({
      content: content,
      language: 'cedar',
    });
    await vscode.window.showTextDocument(doc);

    const provider = new completion.CedarCompletionItemProvider();
    const items = await provider.provideCompletionItems(
      doc,
      new vscode.Position(0, content.length),
      mockToken,
      lastCharacter
        ? {
            triggerKind: vscode.CompletionTriggerKind.TriggerCharacter,
            triggerCharacter: content.substring(content.length - 1),
          }
        : {
            triggerKind: vscode.CompletionTriggerKind.Invoke,
            triggerCharacter: undefined,
          }
    );

    return items;
  };

  test('p at beginning of line', async () => {
    const items = await invokeAt(new vscode.Position(3, 1));

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).description,
        'permit when'
      );
    }
  });

  test('f at beginning of line', async () => {
    const items = await invokeAt(new vscode.Position(4, 1));

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).description,
        'forbid when'
      );
    }
  });

  test('w at beginning of line', async () => {
    const items = await invokeAt(new vscode.Position(5, 1));

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 1);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).description,
        'when condition'
      );
    }
  });

  test('u at beginning of line', async () => {
    const items = await invokeAt(new vscode.Position(6, 1));

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 1);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).description,
        'unless condition'
      );
    }
  });

  const assertEntities = (items: vscode.CompletionItem[] | undefined) => {
    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 3);
      assert.strictEqual(items[0].label, 'N1::E');
      assert.strictEqual(items[1].label, 'N2::E');
      assert.strictEqual(items[2].label, 'Y');
    }
  };

  const assertActionIds = (items: vscode.CompletionItem[] | undefined) => {
    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 6);
      assert.strictEqual(items[0].label, 'N1::Action::"a1"');
      assert.strictEqual(items[1].label, 'N1::Action::"a2"');
      assert.strictEqual(items[2].label, 'N2::Action::"a1"');
      assert.strictEqual(items[3].label, 'N2::Action::"a2"');
      assert.strictEqual(items[4].label, 'N2::Action::"astar"');
      assert.strictEqual(items[5].label, 'Action::"a"');
    }
  };

  test('principal entities', async () => {
    let items = await invokeAt(new vscode.Position(9, 21));
    assertEntities(items);

    items = await invokeAt(new vscode.Position(12, 21));
    assertEntities(items);
  });

  test('principal properties', async () => {
    let items = await invokeAt(new vscode.Position(19, 17), true);
    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
      let itemLabel = items[0].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 'l');
      assert.strictEqual(itemLabel.detail, ': Long');
      itemLabel = items[1].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 's');
      assert.strictEqual(itemLabel.detail, ': String');
    }
  });

  test('commonTypes as properties', async () => {
    const doc = await vscode.workspace.openTextDocument(
      path.join(process.cwd(), 'testdata', 'context', 'commonTypes.cedar')
    );
    let items = await invokeAtTextDocument(
      doc,
      new vscode.Position(1, 17),
      true
    );

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
      let itemLabel = items[0].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 'token_use');
      assert.strictEqual(itemLabel.detail, ': String');
      itemLabel = items[1].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 'jti');
      assert.strictEqual(itemLabel.detail, ': String');
    }

    items = await invokeAtTextDocument(doc, new vscode.Position(2, 15), true);
    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
      let itemLabel = items[0].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 'asAdmin');
      assert.strictEqual(itemLabel.detail, ': Boolean');
      itemLabel = items[1].label as vscode.CompletionItemLabel;
      assert.strictEqual(itemLabel.label, 'token');
      assert.strictEqual(itemLabel.detail, ': Record');
    }

    items = await invokeAtTextDocument(doc, new vscode.Position(3, 21), true);
    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 2);
    }
  });

  test('action ids', async () => {
    let items = await invokeAt(new vscode.Position(9, 33));
    assertActionIds(items);

    items = await invokeAt(new vscode.Position(13, 12));
    assertActionIds(items);
  });

  test('resource entities', async () => {
    let items = await invokeAt(new vscode.Position(9, 47));
    assertEntities(items);

    items = await invokeAt(new vscode.Position(14, 14));
    assertEntities(items);
  });

  test('ip() functions', async () => {
    const content = 'ip("127.0.0.1").';
    const items = await triggerLastCharacter(content);

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 5);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).label,
        'isIpv4'
      );
    }
  });

  test('ip() snippet', async () => {
    const content = '  i';
    const items = await triggerLastCharacter(content, false);

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 1);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).label,
        'ip'
      );
    }
  });

  test('decimal() functions', async () => {
    const content = 'decimal("0.1234").';
    const items = await triggerLastCharacter(content);

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 4);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).label,
        'lessThan'
      );
    }
  });

  test('decimal() snippet', async () => {
    const content = '  d';
    const items = await triggerLastCharacter(content, false);

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 1);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).label,
        'decimal'
      );
    }
  });

  test('set functions', async () => {
    const content = '[].';
    const items = await triggerLastCharacter(content);

    assert.ok(items);
    if (items) {
      assert.strictEqual(items.length, 3);
      assert.strictEqual(
        (items[0].label as vscode.CompletionItemLabel).label,
        'contains'
      );
    }
  });
});
