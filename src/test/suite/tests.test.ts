// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { before } from 'mocha';

import { parseCedarTestsDoc } from '../../parser';
import {
  CEDAR_TESTS_GLOB,
  detectTestsDoc,
  getCedarTestFiles,
} from '../../fileutil';
import { CedarTest, parseTestsDocText, validateTestsDoc } from '../../validate';
import { CedarTestsDocumentSymbolProvider } from '../../documentsymbols';
import { CedarTestsDefinitionProvider } from '../../definition';
import {
  addTestsJSON,
  CedarTestsJSONCompletionItemProvider,
} from '../../completionjson';
import { createDiagnosticCollection } from '../../diagnostics';
import {
  evaluateTest,
  gatherTestRun,
  resolveCedarTestItems,
} from '../../testing';

const photoappPath = (filename: string): string =>
  path.join(process.cwd(), 'testdata', 'photoapp', filename);

const openPhotoapp = async (filename: string): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(photoappPath(filename));

const mockToken: vscode.CancellationToken = new vscode.CancellationTokenSource()
  .token;

suite('Cedar Tests Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('detect cedartests.json', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    assert.equal(detectTestsDoc(testsDoc), true);

    const entitiesDoc = await openPhotoapp('cedarentities.json');
    assert.equal(detectTestsDoc(entitiesDoc), false);
  });

  test('detect *.cedartests.json', async () => {
    const testsDoc = await openPhotoapp('invalid.cedartests.json');
    assert.equal(detectTestsDoc(testsDoc), true);
  });

  test('document selector matches Cedar tests files', async () => {
    const selector = { language: 'json', pattern: CEDAR_TESTS_GLOB };

    for (const filename of ['cedartests.json', 'invalid.cedartests.json']) {
      const doc = await openPhotoapp(filename);
      assert.ok(vscode.languages.match(selector, doc) > 0, filename);
    }

    const entitiesDoc = await openPhotoapp('cedarentities.json');
    assert.equal(vscode.languages.match(selector, entitiesDoc), 0);
  });

  test('parse tests', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    assert.equal(item.tests.length, 17);
    assert.equal(
      item.tests[0].name,
      'DoePhotos: JaneDoe views JohnDoe.jpg -> allow (DoeFamily group, via template link)',
    );
    assert.equal(item.tests[0].decision, 'allow');
    assert.equal(item.tests[2].decision, 'deny');

    // each test has a request and (in this file) inline entities
    item.tests.forEach((test) => {
      assert.ok(test.requestRange, `${test.name} requestRange`);
      assert.ok(test.entitiesRange, `${test.name} entitiesRange`);
      assert.ok(test.nameRange, `${test.name} nameRange`);
      assert.ok(
        test.range.contains(test.requestRange as vscode.Range),
        `${test.name} request inside test`,
      );
      assert.ok(
        test.range.contains(test.entitiesRange as vscode.Range),
        `${test.name} entities inside test`,
      );
    });
  });

  test('parse tests references', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    // one action per test
    assert.equal(item.actionIds.length, 17);
    assert.ok(
      item.actionIds.every((actionId) =>
        actionId.name.startsWith('PhotoApp::Action::'),
      ),
    );

    // principal and resource of each request, plus the inline entities
    assert.ok(item.referencedTypes.length > 17 * 2);
    assert.ok(
      item.referencedTypes.every((t) => t.name.startsWith('PhotoApp::')),
    );

    // policy ids from "reason"
    const policyIds = item.policyIds.map((p) => p.name);
    assert.ok(policyIds.includes('Photo-owner'));
    assert.ok(policyIds.includes('Photo-labels-private'));
    assert.ok(policyIds.includes('DoeFamily-DoePhotos'));
    assert.ok(policyIds.includes('JohnDoe-JaneVacation'));
  });

  test('semantic tokens', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    // 5 values per token in the encoded data
    assert.ok(item.tokens.data.length > 0);
    assert.equal(item.tokens.data.length % 5, 0);
  });

  test('document symbols', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const symbols =
      await new CedarTestsDocumentSymbolProvider().provideDocumentSymbols(
        testsDoc,
        mockToken,
      );

    assert.equal(symbols.length, 17);
    assert.equal(symbols[0].detail, 'allow');
    assert.equal(symbols[0].kind, vscode.SymbolKind.Event);
    assert.deepEqual(
      symbols[0].children.map((child) => child.name),
      ['request', 'entities'],
    );
  });

  test('find related Cedar files', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const { schemaDoc, policyDocs, templateLinksDoc, entitiesDoc } =
      await getCedarTestFiles(testsDoc);

    assert.ok(schemaDoc?.fileName.endsWith('photoapp.cedarschema'));
    assert.equal(policyDocs.length, 1);
    assert.ok(policyDocs[0].fileName.endsWith('policies.cedar'));
    assert.ok(templateLinksDoc?.fileName.endsWith('cedartemplatelinks.json'));
    assert.ok(entitiesDoc?.fileName.endsWith('cedarentities.json'));
  });

  test('definition of policy id in reason', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    const staticPolicy = item.policyIds.find(
      (p) => p.name === 'Photo-owner',
    ) as { name: string; range: vscode.Range };
    const definition =
      await new CedarTestsDefinitionProvider().provideDefinition(
        testsDoc,
        staticPolicy.range.start,
        mockToken,
      );
    const location = definition as vscode.Location;
    assert.ok(location?.uri.fsPath.endsWith('policies.cedar'));
  });

  test('definition of template link id in reason', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    const link = item.policyIds.find(
      (p) => p.name === 'DoeFamily-DoePhotos',
    ) as { name: string; range: vscode.Range };
    const definition =
      await new CedarTestsDefinitionProvider().provideDefinition(
        testsDoc,
        link.range.start,
        mockToken,
      );
    const location = definition as vscode.Location;
    assert.ok(location?.uri.fsPath.endsWith('cedartemplatelinks.json'));
  });

  test('definition of entity type in request', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const item = parseCedarTestsDoc(testsDoc);

    const definition =
      await new CedarTestsDefinitionProvider().provideDefinition(
        testsDoc,
        item.referencedTypes[0].range.start,
        mockToken,
      );
    const location = definition as vscode.Location;
    assert.ok(location?.uri.fsPath.endsWith('photoapp.cedarschema'));
  });

  test('validate valid tests', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const diagnosticCollection = createDiagnosticCollection();
    const success = await validateTestsDoc(
      testsDoc,
      diagnosticCollection,
      true,
    );
    assert.equal(
      success,
      true,
      JSON.stringify(
        (diagnosticCollection.get(testsDoc.uri) || []).map((d) => d.message),
      ),
    );
    diagnosticCollection.dispose();
  });

  test('validate invalid tests', async () => {
    const testsDoc = await openPhotoapp('invalid.cedartests.json');
    const diagnosticCollection = createDiagnosticCollection();
    const success = await validateTestsDoc(
      testsDoc,
      diagnosticCollection,
      true,
    );
    assert.equal(success, false);

    const messages = (diagnosticCollection.get(testsDoc.uri) || []).map(
      (d) => d.message,
    );
    // missing "request" and its principal/action/resource are not reported twice
    assert.ok(messages.includes('Cedar test is missing a "request"'));
    assert.ok(
      messages.some((m) => m.startsWith('"decision" must be')),
      JSON.stringify(messages),
    );
    assert.ok(
      messages.includes('"reason" must be an array of policy id strings'),
    );
    assert.ok(messages.includes('"num_errors" must be a number'));
    // entity attribute not in the schema
    assert.ok(
      messages.some((m) => m.includes('notInSchema')),
      JSON.stringify(messages),
    );
    diagnosticCollection.dispose();
  });

  test('validate tests with a missing name', async () => {
    const testsDoc = await openPhotoapp('noname.cedartests.json');
    const diagnosticCollection = createDiagnosticCollection();
    // a missing name is a warning, so validation still succeeds
    assert.equal(
      await validateTestsDoc(testsDoc, diagnosticCollection, true),
      true,
    );

    const diagnostics = diagnosticCollection.get(testsDoc.uri) || [];
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].message, 'Cedar test is missing a "name"');
    assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    diagnosticCollection.dispose();
  });

  test('a non-object entry keeps test indexes aligned', async () => {
    const testsDoc = await openPhotoapp('notobject.cedartests.json');
    const diagnostics: vscode.Diagnostic[] = [];
    const tests = parseTestsDocText(testsDoc, diagnostics) as CedarTest[];

    assert.equal(tests.length, 2);
    assert.equal(parseCedarTestsDoc(testsDoc).tests.length, 2);
    assert.ok(
      diagnostics.some((d) => d.message === 'expected a Cedar test object'),
    );

    // the second entry is still a runnable test
    assert.equal(tests[1].name, 'still runnable');
    const testRun = await gatherTestRun(testsDoc);
    assert.deepEqual(evaluateTest(tests[1], testRun).failures, []);
  });

  test('validate malformed JSON', async () => {
    const testsDoc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: '[{ "name": "no closing brace" ',
    });
    const diagnostics: vscode.Diagnostic[] = [];
    assert.equal(parseTestsDocText(testsDoc, diagnostics), undefined);
    assert.ok(diagnostics.length > 0);
  });

  test('validate tests file which is not an array', async () => {
    const testsDoc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: '{ "name": "not an array" }',
    });
    const diagnostics: vscode.Diagnostic[] = [];
    assert.equal(parseTestsDocText(testsDoc, diagnostics), undefined);
    assert.equal(
      diagnostics[0].message,
      'Cedar tests file must contain an array of tests',
    );
  });

  test('isAuthorized evaluates every test', async () => {
    const schema = fs.readFileSync(
      photoappPath('photoapp.cedarschema'),
      'utf8',
    );
    const policies = fs.readFileSync(photoappPath('policies.cedar'), 'utf8');
    const templateLinks = fs.readFileSync(
      photoappPath('cedartemplatelinks.json'),
      'utf8',
    );
    const tests: CedarTest[] = JSON.parse(
      fs.readFileSync(photoappPath('cedartests.json'), 'utf8'),
    );
    assert.equal(tests.length, 17);

    tests.forEach((test) => {
      const result = cedar.isAuthorized(
        schema,
        false, // Cedar (not JSON) schema
        policies,
        templateLinks,
        JSON.stringify(test.entities),
        JSON.stringify(test.request),
      );
      try {
        assert.equal(
          result.success,
          true,
          `${test.name}: ${JSON.stringify(Array.from(result.errors))}`,
        );
        assert.equal(result.decision, test.decision, test.name);
        assert.deepEqual(
          Array.from(result.reasons).sort(),
          (test.reason || []).sort(),
          test.name,
        );
        assert.equal(result.errors.length, test.num_errors, test.name);
      } finally {
        result.free();
      }
    });
  });

  test('isAuthorized reports an unusable request', async () => {
    const result = cedar.isAuthorized('', false, '', '', '[]', '{}');
    try {
      assert.equal(result.success, false);
      assert.equal(result.decision, undefined);
      assert.equal(result.errors.length, 1);
    } finally {
      result.free();
    }
  });

  test('test runner gathers the Cedar files for a run', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const testRun = await gatherTestRun(testsDoc);

    assert.equal(testRun.schemaIsJson, false);
    assert.ok(testRun.schema.includes('namespace PhotoApp'));
    assert.ok(testRun.policies.includes('@id("Photo-owner")'));
    assert.ok(testRun.templateLinks.includes('DoeFamily-DoePhotos'));
    assert.ok(testRun.entities.includes('PhotoApp::Application'));
  });

  test('test runner passes every test', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const testRun = await gatherTestRun(testsDoc);
    const tests = parseTestsDocText(testsDoc, []) as CedarTest[];

    tests.forEach((test) => {
      const { failures } = evaluateTest(test, testRun);
      assert.deepEqual(failures, [], test.name);
    });
  });

  test('test runner reports a wrong expected decision', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const testRun = await gatherTestRun(testsDoc);
    const tests = parseTestsDocText(testsDoc, []) as CedarTest[];

    const { failures, expected, actual } = evaluateTest(
      { ...tests[0], decision: 'deny', reason: ['Photo-owner'] },
      testRun,
    );
    assert.deepEqual(failures, [
      'expected deny but was allow',
      'expected reason [Photo-owner] but was [DoeFamily-DoePhotos]',
    ]);
    assert.ok(expected.includes('decision: deny'));
    assert.ok(actual.includes('decision: allow'));
  });

  test('test runner falls back to the entities file', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    const testRun = await gatherTestRun(testsDoc);
    const tests = parseTestsDocText(testsDoc, []) as CedarTest[];

    const { entities, ...withoutEntities } = tests[0];
    const { failures } = evaluateTest(withoutEntities, testRun);
    assert.deepEqual(failures, []);
  });

  const complete = async (
    testsDoc: vscode.TextDocument,
    position: vscode.Position,
  ) => {
    const items =
      await new CedarTestsJSONCompletionItemProvider().provideCompletionItems(
        testsDoc,
        position,
        mockToken,
        {
          triggerKind: vscode.CompletionTriggerKind.Invoke,
          triggerCharacter: undefined,
        },
      );
    const labels = items.map(
      (item) => (item.label as vscode.CompletionItemLabel).label,
    );
    const snippetFor = (label: string): string =>
      (items[labels.indexOf(label)].insertText as vscode.SnippetString).value;

    return { items, labels, snippetFor };
  };

  // every tab stop from 1..n is used exactly once
  const assertTabOrder = (snippet: string) => {
    const tabstops = [...snippet.matchAll(/\$\{?(\d+)/g)]
      .map((found) => Number(found[1]))
      .sort((a, b) => a - b);
    assert.deepEqual(
      tabstops,
      Array.from({ length: tabstops.length }, (_, i) => i + 1),
      snippet,
    );
  };

  test('completion of a new test', async () => {
    const testsDoc = await openPhotoapp('empty.cedartests.json');
    const { labels, snippetFor } = await complete(
      testsDoc,
      new vscode.Position(1, 2),
    );

    assert.deepEqual(labels, [
      'PhotoApp::Action::"editPhoto"',
      'PhotoApp::Action::"viewPhoto"',
      'PhotoApp::Action::"deletePhoto"',
    ]);

    // viewPhoto declares an optional judgingSession Bool context attribute
    const viewPhoto = snippetFor('PhotoApp::Action::"viewPhoto"');
    assert.equal(
      viewPhoto,
      `{
  "name": "$1",
  "request": {
    "principal": "\${2|PhotoApp::User|}::\\"$3\\"",
    "action": "PhotoApp::Action::\\"viewPhoto\\"",
    "resource": "\${4|PhotoApp::Photo|}::\\"$5\\"",
    "context": {
      "judgingSession": \${6|false,true|}
    }
  },
  "decision": "\${7|allow,deny|}",
  "reason": [$8],
  "num_errors": \${9:0}
}`,
    );
    assertTabOrder(viewPhoto);

    // editPhoto declares an empty context
    const editPhoto = snippetFor('PhotoApp::Action::"editPhoto"');
    assert.equal(
      editPhoto,
      `{
  "name": "$1",
  "request": {
    "principal": "\${2|PhotoApp::User|}::\\"$3\\"",
    "action": "PhotoApp::Action::\\"editPhoto\\"",
    "resource": "\${4|PhotoApp::Photo|}::\\"$5\\"",
    "context": {$6}
  },
  "decision": "\${7|allow,deny|}",
  "reason": [$8],
  "num_errors": \${9:0}
}`,
    );
    assertTabOrder(editPhoto);
  });

  test('completion of a new test after typing the brace', async () => {
    const testsDoc = await openPhotoapp('brace.cedartests.json');
    const { labels, snippetFor } = await complete(
      testsDoc,
      new vscode.Position(1, 3),
    );

    assert.ok(labels.includes('PhotoApp::Action::"viewPhoto"'));
    // the user already typed the `{`, so the snippet is the body only
    const viewPhoto = snippetFor('PhotoApp::Action::"viewPhoto"');
    assert.ok(!viewPhoto.startsWith('{'), viewPhoto);
    assert.ok(viewPhoto.startsWith('\n  "name": "$1",'), viewPhoto);
    assert.ok(viewPhoto.endsWith('"num_errors": ${9:0}\n'), viewPhoto);
  });

  test('completion of an entity inside a test', async () => {
    const testsDoc = await openPhotoapp('entity.cedartests.json');
    const { labels, snippetFor } = await complete(
      testsDoc,
      new vscode.Position(11, 8),
    );

    assert.ok(labels.includes('PhotoApp::Photo'), JSON.stringify(labels));

    // matches the snippet offered in a Cedar entities file
    const photo = snippetFor('PhotoApp::Photo');
    assert.equal(
      photo,
      `
  "uid": { "type": "PhotoApp::Photo", "id": "$1" },
  "attrs": {
    "labels": [$2],
    "owner": { "type": "PhotoApp::User", "id": "$3" },
    "subjects": [$4]
  },
  "parents": [$5]
`,
    );
    assertTabOrder(photo);
  });

  test('completion outside a test or entities array', async () => {
    const testsDoc = await openPhotoapp('cedartests.json');
    // inside the "request" object of the first test
    const { items } = await complete(testsDoc, new vscode.Position(3, 6));
    assert.deepEqual(items, []);
  });

  test('Cedar tests commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('cedar.testsvalidate'));
    assert.ok(commands.includes('cedar.testsadd'));
  });

  test('add Cedar test inserts valid JSON', async () => {
    const testsDoc = await openPhotoapp('add.cedartests.json');
    const textEditor = await vscode.window.showTextDocument(testsDoc);
    const diagnosticCollection = createDiagnosticCollection();
    const showQuickPick = vscode.window.showQuickPick;

    try {
      // pick the viewPhoto action, which has a context attribute
      (vscode.window as any).showQuickPick = async (
        items: vscode.QuickPickItem[],
      ) => items.find((item) => item.label === 'PhotoApp::Action::"viewPhoto"');

      assert.equal(await addTestsJSON(textEditor, diagnosticCollection), true);

      // the snippet, with its tab stops resolved, is still valid JSON
      const tests: CedarTest[] = JSON.parse(testsDoc.getText());
      assert.equal(tests.length, 2);
      assert.equal(tests[0].name, 'existing');
      assert.equal(tests[1].request?.action, 'PhotoApp::Action::"viewPhoto"');
      assert.equal(tests[1].request?.principal, 'PhotoApp::User::""');
      assert.equal(tests[1].request?.resource, 'PhotoApp::Photo::""');
      assert.deepEqual(tests[1].request?.context, { judgingSession: false });
      assert.equal(tests[1].decision, 'allow');
      assert.deepEqual(tests[1].reason, []);
      assert.equal(tests[1].num_errors, 0);
    } finally {
      (vscode.window as any).showQuickPick = showQuickPick;
      diagnosticCollection.dispose();
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  });

  test('test controller discovers the tests in a file', async () => {
    const controller = vscode.tests.createTestController(
      'cedar.test',
      'Cedar (test)',
    );
    try {
      const uri = vscode.Uri.file(photoappPath('cedartests.json'));
      const fileItem = controller.createTestItem(
        uri.toString(),
        'cedartests.json',
        uri,
      );
      fileItem.canResolveChildren = true;
      controller.items.add(fileItem);

      await resolveCedarTestItems(controller, fileItem);

      assert.equal(fileItem.children.size, 17);
      const first = fileItem.children.get(`${uri.toString()}#0`);
      assert.ok(first);
      assert.ok(first?.label.startsWith('DoePhotos: JaneDoe views'));
      assert.ok(first?.range);
      assert.equal(
        fileItem.children.get(`${uri.toString()}#16`)?.label,
        'Context: JorgeSouza views contest sunset.jpg with no context -> deny (judgingSession absent)',
      );
    } finally {
      controller.dispose();
    }
  });
});
