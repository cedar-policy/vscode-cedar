// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { before } from 'mocha';

import {
  parseCedarAuthDoc,
  parseCedarJsonPolicyDoc,
  parseCedarTemplateLinksDoc,
  parseCedarTestsDoc,
  semanticTokensLegend,
} from '../../parser';
import * as cedar from 'vscode-cedar-wasm';
import {
  CedarJsonDefinitionProvider,
  CedarTemplateLinksDefinitionProvider,
} from '../../definition';

/*
 * Cedar variables and template slots in Cedar JSON files use semantic tokens
 * which package.json scopes to the Cedar grammar's variable.language.cedar and
 * variable.parameter.cedar, so they are colored the same as in Cedar files.
 */

const openTestData = async (
  dirname: string,
  filename: string,
): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', dirname, filename),
  );
const openPhotoapp = async (filename: string): Promise<vscode.TextDocument> =>
  openTestData('photoapp', filename);

// decode semantic tokens to `text: type.modifier` strings
const decodeTokens = (
  doc: vscode.TextDocument,
  tokens: vscode.SemanticTokens,
): string[] => {
  const decoded: string[] = [];
  let line = 0;
  let character = 0;
  for (let i = 0; i < tokens.data.length; i += 5) {
    const [deltaLine, deltaStart, length, type, modifiers] = tokens.data.slice(
      i,
      i + 5,
    );
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;
    const text = doc.getText(
      new vscode.Range(line, character, line, character + length),
    );
    const modifierNames = semanticTokensLegend.tokenModifiers.filter(
      (_, bit) => modifiers & (1 << bit),
    );
    decoded.push(
      [
        `${text}: ${semanticTokensLegend.tokenTypes[type]}`,
        ...modifierNames,
      ].join('.'),
    );
  }
  return decoded;
};

const mockToken: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

suite('Cedar JSON Semantic Tokens Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('template links slots', async () => {
    const doc = await openPhotoapp('cedartemplatelinks.json');
    const tokens = decodeTokens(doc, parseCedarTemplateLinksDoc(doc).tokens);
    assert.ok(tokens.includes('"?principal": parameter'), tokens.join('\n'));
    assert.ok(tokens.includes('"?resource": parameter'));
    assert.ok(tokens.includes('"viewPhoto-template": function'));
  });

  test('template links template_id goes to the template', async () => {
    const doc = await openPhotoapp('cedartemplatelinks.json');
    const templateId = parseCedarTemplateLinksDoc(doc).templateIds[0];
    assert.equal(templateId.name, 'viewPhoto-template');
    const definition =
      await new CedarTemplateLinksDefinitionProvider().provideDefinition(
        doc,
        templateId.range.start,
        mockToken,
      );
    const location = definition as vscode.Location;
    assert.ok(location?.uri.fsPath.endsWith('policies.cedar'));
    const policyDoc = await vscode.workspace.openTextDocument(location.uri);
    assert.ok(
      policyDoc.getText(location.range).includes('@id("viewPhoto-template")'),
    );
  });

  test('tests request variables', async () => {
    const doc = await openPhotoapp('cedartests.json');
    const tokens = decodeTokens(doc, parseCedarTestsDoc(doc).tokens);
    for (const variable of ['principal', 'action', 'resource', 'context']) {
      assert.ok(
        tokens.includes(`"${variable}": variable.defaultLibrary`),
        variable,
      );
    }
  });

  test('auth request variables', async () => {
    const doc = await openPhotoapp('cedarauth.json');
    const tokens = decodeTokens(doc, parseCedarAuthDoc(doc).tokens);
    for (const variable of ['principal', 'action', 'resource', 'context']) {
      assert.ok(
        tokens.includes(`"${variable}": variable.defaultLibrary`),
        `${variable}: ${tokens.join('\n')}`,
      );
    }
  });

  test('Cedar JSON policy variables and slots', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        {
          effect: 'permit',
          principal: { op: 'in', slot: '?principal' },
          action: { op: 'All' },
          resource: { op: 'in', slot: '?resource' },
          conditions: [
            {
              kind: 'when',
              body: {
                '==': {
                  left: { ['Var']: 'context' },
                  right: { ['Var']: 'principal' },
                },
              },
            },
          ],
        },
        null,
        2,
      ),
    });
    const tokens = decodeTokens(doc, parseCedarJsonPolicyDoc(doc).tokens);
    assert.ok(tokens.includes('"principal": variable.defaultLibrary'));
    assert.ok(tokens.includes('"?principal": parameter'), tokens.join('\n'));
    assert.ok(tokens.includes('"?resource": parameter'));
    assert.ok(tokens.includes('"context": variable.defaultLibrary'));
  });

  test('template links link_id', async () => {
    const doc = await openPhotoapp('cedartemplatelinks.json');
    const tokens = decodeTokens(doc, parseCedarTemplateLinksDoc(doc).tokens);
    assert.ok(tokens.includes('"DoeFamily-DoePhotos": function.declaration'));
  });

  test('tests num_errors and request context', async () => {
    const doc = await openTestData('schemaset-external', 'cedartests.json');
    const item = parseCedarTestsDoc(doc);
    const tokens = decodeTokens(doc, item.tokens);
    assert.ok(tokens.includes('"num_errors": variable.readonly'));
    assert.ok(tokens.includes('"recipient": property'), tokens.join('\n'));
    assert.ok(tokens.includes('"__entity": macro'));
    assert.ok(tokens.includes('"DocApp::Team": type'));
    assert.ok(item.referencedTypes.some((t) => t.name === 'DocApp::Team'));
  });

  test('auth request context', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        {
          principal: 'App::User::"alice"',
          action: 'App::Action::"view"',
          resource: 'App::Doc::"plan"',
          context: {
            recipient: { ['__entity']: { type: 'App::Team', id: 'Writers' } },
            ['source_ip']: { ['__extn']: { fn: 'ip', arg: '10.0.0.1' } },
          },
        },
        null,
        2,
      ),
    });
    const item = parseCedarAuthDoc(doc);
    const tokens = decodeTokens(doc, item.tokens);
    assert.ok(tokens.includes('"recipient": property'), tokens.join('\n'));
    assert.ok(tokens.includes('"__entity": macro'));
    assert.ok(tokens.includes('"App::Team": type'));
    assert.ok(tokens.includes('"__extn": macro'));
    assert.ok(tokens.includes('"ip": function'));
    assert.ok(item.referencedTypes.some((t) => t.name === 'App::Team'));
  });

  test('Cedar JSON conditions', async () => {
    const result = cedar.exportPolicyTemplate(
      `permit (principal, action, resource is App::Doc in ?resource)
      when {
        !(principal is App::User) &&
        resource.title like "a*" &&
        [1].contains(1) &&
        ip("10.0.0.1").isInRange(ip("10.0.0.0/8")) &&
        {"in": 1}["in"] == -context.n
      };`,
    );
    assert.ok(result.success);
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(JSON.parse(result.json as string), null, 2),
    });
    result.free();
    const item = parseCedarJsonPolicyDoc(doc);
    const tokens = decodeTokens(doc, item.tokens);
    for (const expected of [
      '"?resource": parameter',
      '"App::Doc": type',
      '"App::User": type',
      '"!": operator',
      '"is": operator',
      '"like": operator',
      '"Wildcard": operator',
      '"neg": operator',
      '"contains": function',
      '"ip": function',
      '"isInRange": function',
    ]) {
      assert.ok(tokens.includes(expected), `${expected}\n${tokens.join('\n')}`);
    }
    // a record attribute named "in" is not an operator
    assert.equal(tokens.filter((t) => t === '"in": operator').length, 0);
    assert.ok(item.referencedTypes.some((t) => t.name === 'App::User'));
  });

  test('Cedar JSON policy set templateId goes to the template', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        {
          staticPolicies: {},
          templates: {
            t0: {
              effect: 'permit',
              principal: { op: '==', slot: '?principal' },
              action: { op: 'All' },
              resource: { op: 'All' },
              conditions: [],
            },
          },
          templateLinks: [
            {
              templateId: 't0',
              newId: 'link0',
              values: { '?principal': { type: 'App::User', id: 'alice' } },
            },
          ],
        },
        null,
        2,
      ),
    });
    const item = parseCedarJsonPolicyDoc(doc);
    const tokens = decodeTokens(doc, item.tokens);
    assert.ok(tokens.includes('"t0": function.declaration'), tokens.join('\n'));
    assert.ok(tokens.includes('"t0": function'));
    assert.ok(tokens.includes('"link0": function.declaration'));
    assert.ok(tokens.includes('"?principal": parameter'));

    const definition =
      await new CedarJsonDefinitionProvider().provideDefinition(
        doc,
        item.templateIds[0].range.start,
        mockToken,
      );
    const location = definition as vscode.Location;
    assert.equal(doc.getText(location.range), 't0');
    assert.ok(location.range.start.line < item.templateIds[0].range.start.line);
  });
});
