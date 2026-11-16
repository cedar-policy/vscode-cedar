// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  getPolicyScopeDisplay,
  getPolicyScopes,
  onDidChangePolicyScopes,
} from './validate';
import { getSchemaTextDocument } from './fileutil';
import { findDefinition, schemaDefinitionDocs } from './definition';

/*
 * The principal types, actions, and resource types each Cedar policy applies
 * to, as a CodeLens per kind which navigates to their schema declarations
 */

export const PICK_SCOPE_COMMAND = 'cedar.policyScope.pick';

type ScopeKind = 'principal' | 'action' | 'resource';

const describeScope = (
  kind: ScopeKind,
  items: string[],
): { title: string; tooltip: string } => {
  const noun = items.length === 1 ? kind : `${kind}s`;
  return {
    title: `${items.length} ${noun}`,
    tooltip: `${items.join('\n')}\nGo to schema declaration`,
  };
};

export class PolicyScopeCodeLensProvider implements vscode.CodeLensProvider {
  onDidChangeCodeLenses = onDidChangePolicyScopes;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (getPolicyScopeDisplay(document) !== 'codeLens') {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    getPolicyScopes(document).forEach(({ effectRange, entityTypes }) => {
      // every request environment has a principal, action, and resource, so
      // none of them means an impossible policy, which is already a warning
      if (entityTypes.actions.length === 0) {
        return;
      }
      const segments: [ScopeKind, string[]][] = [
        ['principal', entityTypes.principals],
        ['action', entityTypes.actions],
        ['resource', entityTypes.resources],
      ];
      segments.forEach(([kind, items]) => {
        const { title, tooltip } = describeScope(kind, items);
        lenses.push(
          new vscode.CodeLens(effectRange, {
            command: PICK_SCOPE_COMMAND,
            title: title,
            tooltip: tooltip,
            arguments: [document.uri, kind, items],
          }),
        );
      });
    });
    return lenses;
  }
}

type ScopeQuickPickItem = vscode.QuickPickItem & {
  location?: vscode.Location;
};

/**
 * Pick one of a policy's principal types, actions, or resource types to go to
 * its declaration in the schema, going directly when there is only one.
 * Definitions are only looked up when the CodeLens is clicked.
 */
export const pickPolicyScope = async (
  uri: vscode.Uri,
  kind: ScopeKind,
  items: string[],
): Promise<void> => {
  if (items.length === 0) {
    return;
  }
  const cedarDoc = await vscode.workspace.openTextDocument(uri);
  const schemaDoc = await getSchemaTextDocument(cedarDoc);
  const docs = schemaDoc ? await schemaDefinitionDocs(schemaDoc) : [];

  const picks: ScopeQuickPickItem[] = items.map((item) => {
    const definition = findDefinition(docs, item);
    if (definition) {
      return {
        label: item,
        description: path.basename(definition.doc.uri.fsPath),
        location: new vscode.Location(
          definition.doc.uri,
          definition.schemaRange.etypeRange,
        ),
      };
    }
    return { label: item, description: 'declaration not found' };
  });

  const picked =
    picks.length === 1
      ? picks[0]
      : await vscode.window.showQuickPick(picks, {
          title: `${picks.length} ${kind}s`,
          placeHolder: `Go to the schema declaration of a ${kind}`,
          matchOnDescription: true,
        });
  if (picked?.location) {
    await vscode.window.showTextDocument(picked.location.uri, {
      selection: picked.location.range,
    });
  } else if (picked) {
    vscode.window.showInformationMessage(
      `Schema declaration of ${picked.label} not found`,
    );
  }
};
