// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { FUNCTION_HELP_DEFINITIONS } from './help';

export class CedarSignatureHelpProvider implements vscode.SignatureHelpProvider {
  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.SignatureHelpContext
  ): vscode.SignatureHelp | undefined {
    const linePrefix = document
      .lineAt(position)
      .text.substring(0, position.character);

    // Scan backwards for the innermost unmatched '(' on the current line.
    // Track paren depth so nested calls like ip("1.2.3.4").isInRange(ip("..."))
    // resolve to the outermost active call rather than a completed inner one.
    let parenDepth = 0;
    let openParenIndex = -1;
    for (let i = linePrefix.length - 1; i >= 0; i--) {
      const ch = linePrefix[i];
      if (ch === ')') {
        parenDepth++;
      } else if (ch === '(') {
        if (parenDepth === 0) {
          openParenIndex = i;
          break;
        }
        parenDepth--;
      }
    }

    if (openParenIndex === -1) {
      return undefined;
    }

    // Extract the identifier immediately before '('
    const beforeParen = linePrefix.substring(0, openParenIndex);
    const wordMatch = beforeParen.match(/([_a-zA-Z][_a-zA-Z0-9]*)$/);
    if (!wordMatch) {
      return undefined;
    }

    const funcName = wordMatch[1];
    const help = FUNCTION_HELP_DEFINITIONS[funcName];
    if (!help) {
      return undefined;
    }

    const [signatureLabel, description] = help;

    const sigInfo = new vscode.SignatureInformation(
      signatureLabel,
      new vscode.MarkdownString(description)
    );

    // Use [startOffset, endOffset] into signatureLabel to highlight the
    // parameter type when the user is inside the parentheses.
    const parenStart = signatureLabel.indexOf('(');
    const parenEnd = signatureLabel.indexOf(')');
    const paramsStr = signatureLabel.substring(parenStart + 1, parenEnd).trim();
    if (paramsStr.length > 0) {
      sigInfo.parameters = [
        new vscode.ParameterInformation([parenStart + 1, parenEnd] as [
          number,
          number,
        ]),
      ];
    }

    const sigHelp = new vscode.SignatureHelp();
    sigHelp.signatures = [sigInfo];
    sigHelp.activeSignature = 0;
    sigHelp.activeParameter = 0;

    return sigHelp;
  }
}
