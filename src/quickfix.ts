// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { UNRECOGNIZED_REGEX } from './regex';
import {
  COMMAND_CEDAR_VALIDATE,
  COMMAND_CEDAR_SCHEMAVALIDATE,
} from './commands';

export class CedarQuickFix implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    // for each diagnostic entry that has the matching `code`, create a code action command
    const actions: vscode.CodeAction[] = [];

    context.diagnostics.forEach((diagnostic) => {
      if (diagnostic.code === 'unrecognized') {
        const action = this.createUnrecognizedQuickFixAction(
          document,
          diagnostic
        );
        if (action) {
          actions.push(action);
        }
      }
    });

    return actions;
  }

  private createUnrecognizedQuickFixAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    let fix = null;
    const found = diagnostic.message.match(UNRECOGNIZED_REGEX);
    if (found?.groups && found?.groups.suggestion) {
      fix = new vscode.CodeAction(
        `Replace with ${found?.groups.suggestion}`,
        vscode.CodeActionKind.QuickFix
      );
      fix.edit = new vscode.WorkspaceEdit();
      fix.edit.replace(
        document.uri,
        diagnostic.range,
        found?.groups.suggestion
      );
      fix.isPreferred = true;
      fix.diagnostics = [diagnostic];
      fix.command = {
        command: COMMAND_CEDAR_VALIDATE,
        title: 'Validate Cedar policy',
      };
    }

    return fix;
  }
}

const CEDARSCHEMA_JSON = `{
  "": {
    "entityTypes": {},
    "actions": {}
  }
}`;

export class CedarSchemaJSONQuickFix implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    // for each diagnostic entry that has the matching `code`, create a code action command
    const actions: vscode.CodeAction[] = [];

    context.diagnostics.forEach((diagnostic) => {
      if (diagnostic.code === 'undeclared') {
        const action = this.createUndeclaredCommonTypeQuickFixAction(
          document,
          diagnostic
        );
        if (action) {
          actions.push(action);
        }
      } else if (diagnostic.code === 'empty') {
        actions.push(
          this.createSchemaCodeAction(
            document,
            diagnostic,
            `Insert Cedar schema`,
            CEDARSCHEMA_JSON
          )
        );
      }
    });

    return actions;
  }

  private createUndeclaredCommonTypeQuickFixAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    let fix = null;

    if (diagnostic.message.startsWith('undeclared common type:')) {
      const type = diagnostic.message.substring(
        diagnostic.message.indexOf(': ') + 2
      );
      let suggestion;

      for (const t of 'String|Long|Boolean|Record|Set|Entity|Extension'.split(
        '|'
      )) {
        if (type.toLowerCase() === t.toLowerCase()) {
          suggestion = t;
          break;
        }
      }

      if (suggestion) {
        fix = this.createSchemaCodeAction(
          document,
          diagnostic,
          `Replace with ${suggestion}`,
          suggestion
        );
      }
    }

    return fix;
  }

  private createSchemaCodeAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    title: string,
    suggestion: string
  ): vscode.CodeAction {
    const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    fix.edit = new vscode.WorkspaceEdit();
    fix.edit.replace(document.uri, diagnostic.range, suggestion);
    fix.isPreferred = true;
    fix.diagnostics = [diagnostic];
    fix.command = {
      command: COMMAND_CEDAR_SCHEMAVALIDATE,
      title: 'Validate Cedar schema',
    };

    return fix;
  }
}
