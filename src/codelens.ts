// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { getSchemaTextDocument } from './fileutil';

export class ValidateWithSchemaCodeLensProvider
  implements vscode.CodeLensProvider
{
  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const schemaDoc = await getSchemaTextDocument(document);
    if (schemaDoc) {
      let schemaFileName = schemaDoc?.uri.fsPath;
      const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
      if (workspace?.uri) {
        schemaFileName = schemaFileName.substring(
          workspace.uri.fsPath.length + 1
        );
      }

      const openCommand: vscode.Command = {
        command: 'vscode.open',
        title: `Validated using Cedar schema: ${schemaFileName}`,
        tooltip: `Open ${schemaDoc?.uri.fsPath}`,
        arguments: [schemaDoc?.uri],
      };

      const codeLens = new vscode.CodeLens(
        new vscode.Range(0, 0, 0, 0),
        openCommand
      );

      return Promise.resolve([codeLens]);
    }

    return Promise.resolve([]);
  }
}
