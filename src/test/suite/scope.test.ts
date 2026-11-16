// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as path from 'node:path';
import { before } from 'mocha';
import { createDiagnosticCollection } from '../../diagnostics';
import {
  determinePoliciesEntityTypes,
  getPolicyScopes,
  getSchemaHandle,
  PolicyScope,
  validateCedarDoc,
} from '../../validate';
import { parseCedarPoliciesDoc } from '../../parser';
import { pickPolicyScope, PolicyScopeCodeLensProvider } from '../../scope';

const openScope = (filename: string) =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', 'scope', filename),
  );

// a policy @id of "-" is no entity types
const expectedFromId = (id: string) => {
  const [principals, actions, resources] = id
    .split(' ')
    .map((part) => (part === '-' ? [] : part.split(',')));
  return {
    principals: principals.map((p) => `NS::${p}`),
    actions: actions.map((a) => `NS::Action::"${a}"`),
    resources: resources.map((r) => `NS::${r}`),
  };
};

const validateScopes = async (): Promise<{
  cedarDoc: vscode.TextDocument;
  scopes: PolicyScope[];
}> => {
  const cedarDoc = await openScope('policies.cedar');
  const diagnosticCollection = createDiagnosticCollection();
  try {
    await validateCedarDoc(cedarDoc, diagnosticCollection, true);
  } finally {
    diagnosticCollection.dispose();
  }
  return { cedarDoc, scopes: getPolicyScopes(cedarDoc) };
};

suite('Policy Scope Test Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('schema handle is cached until the schema changes', async () => {
    const schemaDoc = await openScope('scope.cedarschema');
    const handle = getSchemaHandle(schemaDoc);
    assert.ok(handle);
    assert.strictEqual(getSchemaHandle(schemaDoc), handle);

    const invalidDoc = await vscode.workspace.openTextDocument({
      language: 'cedarschema',
      content: 'entity',
    });
    assert.equal(getSchemaHandle(invalidDoc), undefined);
    assert.deepEqual(
      determinePoliciesEntityTypes(invalidDoc, [
        'permit(principal, action, resource);',
      ]),
      [{ principals: [], actions: [], resources: [] }],
    );
  });

  test('schema handle JSON', async () => {
    const handle = cedar.SchemaHandle.fromJSON(
      JSON.stringify({
        '': {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          entityTypes: { User: {}, Photo: {} },
          actions: {
            view: {
              appliesTo: {
                principalTypes: ['User'],
                resourceTypes: ['Photo'],
              },
            },
          },
        },
      }),
    );
    assert.ok(handle);
    try {
      const result = handle.requestEnvs('permit(principal, action, resource);');
      assert.equal(result.success, true);
      assert.deepEqual(result.principals, ['User']);
      assert.deepEqual(result.actions, ['Action::"view"']);
      assert.deepEqual(result.resources, ['Photo']);
      result.free();
    } finally {
      handle.free();
    }
    assert.equal(cedar.SchemaHandle.fromJSON('{'), undefined);
  });

  test('determine entity types of policies in order', async () => {
    const schemaDoc = await openScope('scope.cedarschema');
    const results = determinePoliciesEntityTypes(schemaDoc, [
      'permit(principal is NS::E2, action, resource is NS::R2);',
      'permit(principal, action, resource',
      `permit(principal, action == NS::Action::"a1", resource);`,
    ]);
    assert.deepEqual(results, [
      expectedFromId('E2 a,a2 R2'),
      expectedFromId('- - -'),
      expectedFromId('E1 a1 R1'),
    ]);
    assert.deepEqual(determinePoliciesEntityTypes(schemaDoc, []), []);
  });

  test('schema handle validates the same as parsing the schema', async () => {
    const schemaDoc = await openScope('scope.cedarschema');
    const schema = schemaDoc.getText();
    const handle = getSchemaHandle(schemaDoc)!;
    const plain = (r: cedar.ValidatePolicyResult) => {
      try {
        return {
          success: r.success,
          level: r.level,
          errors: r.errors?.map((e) => [e.message, e.offset, e.length]),
          warnings: r.warnings?.map((e) => [e.message, e.offset, e.length]),
          levelWarnings: r.levelWarnings?.map((e) => e.message),
        };
      } finally {
        r.free();
      }
    };
    const policies = [
      'permit(principal, action, resource);',
      `permit(principal, action == NS::Action::"a1", resource) when { principal.p1 == "x" };`,
      `permit(principal, action, resource) when { principal.p1 == "x" };`,
      'permit(principal is NS::E, action, resource);',
      'permit(principal, action, resource',
    ];
    for (const policy of policies) {
      for (const maxLevel of [undefined, 0]) {
        assert.deepEqual(
          plain(handle.validatePolicy(policy, maxLevel)),
          plain(cedar.validatePolicySchemaCedar(schema, policy, maxLevel)),
          `${policy} ${maxLevel}`,
        );
      }
    }
  });

  test('validated policies have scopes narrowed by their conditions', async () => {
    const { cedarDoc, scopes } = await validateScopes();
    const policies = parseCedarPoliciesDoc(cedarDoc).policies;
    assert.equal(policies.length, 5);

    // the invalid policy has no scope
    const ids = policies
      .filter((policy) =>
        scopes.some((scope) => scope.range.isEqual(policy.range)),
      )
      .map((policy) => policy.id);
    assert.deepEqual(
      ids,
      policies.map((p) => p.id).filter((id) => id !== 'invalid'),
    );

    scopes.forEach((scope) => {
      const policy = policies.find((p) => p.range.isEqual(scope.range))!;
      assert.ok(policy.effectRange.isEqual(scope.effectRange), policy.id);
      assert.deepEqual(scope.entityTypes, expectedFromId(policy.id), policy.id);
    });
  });

  test('scopes are stale once the document changes', async () => {
    const { cedarDoc, scopes } = await validateScopes();
    assert.ok(scopes.length > 0);
    const editor = await vscode.window.showTextDocument(cedarDoc);
    try {
      await editor.edit((edit) =>
        edit.insert(new vscode.Position(0, 0), '// edit\n'),
      );
      assert.deepEqual(getPolicyScopes(cedarDoc), []);
    } finally {
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  });

  test('CodeLens per kind above each validated policy', async () => {
    const { cedarDoc, scopes } = await validateScopes();
    const lenses = new PolicyScopeCodeLensProvider().provideCodeLenses(
      cedarDoc,
    );
    // no CodeLens for the impossible policy
    assert.equal(scopes.length, 4);
    assert.equal(lenses.length, (scopes.length - 1) * 3);

    const first = lenses.slice(0, 3);
    assert.deepEqual(
      first.map((lens) => lens.command?.title),
      ['2 principals', '3 actions', '2 resources'],
    );
    first.forEach((lens) => {
      assert.ok(lens.range.isEqual(scopes[0].effectRange));
      assert.equal(lens.command?.command, 'cedar.policyScope.pick');
      assert.equal(
        lens.command?.arguments?.[0].toString(),
        cedarDoc.uri.toString(),
      );
    });
    assert.deepEqual(first[0].command?.arguments?.slice(1), [
      'principal',
      ['NS::E1', 'NS::E2'],
    ]);
    assert.ok(first[1].command?.tooltip?.includes('NS::Action::"a1"'));

    // singular
    const template = lenses.slice(6, 9).map((lens) => lens.command?.title);
    assert.deepEqual(template, ['1 principal', '1 action', '1 resource']);
    assert.ok(
      lenses.every((lens) => !lens.range.isEqual(scopes[3].effectRange)),
    );
  });

  test('CodeLens hidden by setting', async () => {
    const { cedarDoc } = await validateScopes();
    const config = vscode.workspace.getConfiguration('cedar', cedarDoc.uri);
    await config.update(
      'policyScope.display',
      'none',
      vscode.ConfigurationTarget.Global,
    );
    try {
      assert.deepEqual(
        new PolicyScopeCodeLensProvider().provideCodeLenses(cedarDoc),
        [],
      );
    } finally {
      await config.update(
        'policyScope.display',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
  });

  const activeSelection = () => {
    const editor = vscode.window.activeTextEditor!;
    return {
      file: path.basename(editor.document.uri.fsPath),
      text: editor.document.getText(editor.selection),
    };
  };

  test('pick a single entity type goes to its declaration', async () => {
    const cedarDoc = await openScope('policies.cedar');
    await pickPolicyScope(cedarDoc.uri, 'resource', ['NS::R2']);
    assert.deepEqual(activeSelection(), {
      file: 'scope.cedarschema',
      text: 'R2',
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('pick one of many actions goes to its declaration', async () => {
    const cedarDoc = await openScope('policies.cedar');
    const showQuickPick = vscode.window.showQuickPick;
    let offered: vscode.QuickPickItem[] = [];
    try {
      (vscode.window as any).showQuickPick = async (
        items: vscode.QuickPickItem[],
      ) => {
        offered = items;
        return items[1];
      };
      await pickPolicyScope(cedarDoc.uri, 'action', [
        'NS::Action::"a"',
        'NS::Action::"a1"',
        'NS::Action::"missing"',
      ]);
    } finally {
      (vscode.window as any).showQuickPick = showQuickPick;
    }
    assert.deepEqual(
      offered.map((item) => [item.label, item.description]),
      [
        ['NS::Action::"a"', 'scope.cedarschema'],
        ['NS::Action::"a1"', 'scope.cedarschema'],
        ['NS::Action::"missing"', 'declaration not found'],
      ],
    );
    assert.deepEqual(activeSelection(), {
      file: 'scope.cedarschema',
      text: 'a1',
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('pick with nothing to pick does nothing', async () => {
    const cedarDoc = await openScope('policies.cedar');
    const before = vscode.window.activeTextEditor?.document.uri.toString();
    await pickPolicyScope(cedarDoc.uri, 'principal', []);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      before,
    );
  });
});
