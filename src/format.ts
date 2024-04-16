// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import { scanLeadingComments } from './diagnostics';

export const formatCedarDoc = (
  cedarDoc: vscode.TextDocument
): string | null => {
  let formattedPolicy = null;
  const { skipFormatting } = scanLeadingComments(cedarDoc);

  if (!skipFormatting) {
    const editorConfig = vscode.workspace.getConfiguration('editor', {
      languageId: 'cedar',
    });
    const tabSize = editorConfig.get<number>('tabSize', 2);
    const wordWrapColumn = editorConfig.get<number>('wordWrapColumn', 80);

    const formatResult: cedar.FormatPoliciesResult = cedar.formatPolicies(
      cedarDoc.getText(),
      wordWrapColumn,
      tabSize
    );
    if (formatResult.success) {
      formattedPolicy = formatResult.policy as string;
    }
    formatResult.free();
  }

  return formattedPolicy;
};

export const formatCedarSchemaNaturalDoc = (
  schemaDoc: vscode.TextDocument
): string | null => {
  // TODO: implement after https://github.com/cedar-policy/cedar/issues/682

  return null;
};
