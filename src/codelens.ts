// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { describeSchemaSet, getSchemaSet } from './fileutil';
import {
  COMMAND_CEDAR_SCHEMAOPEN,
  COMMAND_CEDAR_SCHEMATRANSLATE,
} from './commands';

export class ValidateWithSchemaCodeLensProvider
  implements vscode.CodeLensProvider
{
  async provideCodeLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const set = await getSchemaSet(document);
    if (set) {
      const { title, tooltip } = describeSchemaSet(document, set);

      // a single schema file opens directly, otherwise choose a schema file or
      // the combined schema
      const openCommand: vscode.Command =
        set.docs.length === 1
          ? {
              command: 'vscode.open',
              title: title,
              tooltip: tooltip,
              arguments: [set.docs[0].uri],
            }
          : {
              command: COMMAND_CEDAR_SCHEMAOPEN,
              title: title,
              tooltip: tooltip,
            };

      const codeLens = new vscode.CodeLens(
        new vscode.Range(0, 0, 0, 0),
        openCommand,
      );

      return Promise.resolve([codeLens]);
    }

    return Promise.resolve([]);
  }
}

export class TranslateSchemaCodeLensProvider
  implements vscode.CodeLensProvider
{
  async provideCodeLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const translateCommand: vscode.Command = {
      command: COMMAND_CEDAR_SCHEMATRANSLATE,
      title: `Translate Cedar schema`,
    };

    const codeLens = new vscode.CodeLens(
      new vscode.Range(0, 0, 0, 0),
      translateCommand,
    );

    return Promise.resolve([codeLens]);
  }
}
