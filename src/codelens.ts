// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { COMMAND_CEDAR_SCHEMAOPEN } from './commands';
import { getSchemaTextDocument } from './fileutil';

export class ValidateWithSchemaCodeLensProvider
  implements vscode.CodeLensProvider
{
  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const schemaDoc = await getSchemaTextDocument(document);
    if (schemaDoc) {
      let topOfDocument = new vscode.Range(0, 0, 0, 0);

      let schemaFileName = schemaDoc?.uri.fsPath;
      const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
      if (workspace?.uri) {
        schemaFileName = schemaFileName.substring(
          workspace.uri.fsPath.length + 1
        );
      }

      let c: vscode.Command = {
        command: COMMAND_CEDAR_SCHEMAOPEN,
        title: `Validated using Cedar schema: ${schemaFileName}`,
        tooltip: `Open Cedar schema ${schemaDoc?.uri.fsPath}`,
      };

      let codeLens = new vscode.CodeLens(topOfDocument, c);

      return Promise.resolve([codeLens]);
    }

    return Promise.resolve([]);
  }
}
