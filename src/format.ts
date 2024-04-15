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
  let formattedSchema = fixCedarSchemaNaturalText(schemaDoc.getText());

  // TODO: implement after https://github.com/cedar-policy/cedar/issues/682

  return formattedSchema;
};

// temporary fixes to "fix" translated output to JSON schema
export const fixCedarSchemaText = (schemaText: string): string => {
  schemaText = JSON.stringify(
    JSON.parse(schemaText),
    (key, value) => {
      if (
        key === 'additionalAttributes' ||
        (key === 'required' && value === true) ||
        (key === 'memberOf' && value === null)
      ) {
        return undefined;
      }
      return value;
    },
    2
  );

  return schemaText;
};

// temporary fixes to "fix" translated output to human readable schema
export const fixCedarSchemaNaturalText = (schemaText: string): string => {
  schemaText = schemaText.replace(/\s*\n/g, '\n');
  schemaText = schemaText.replace(/{\s*?}/g, '{}');
  schemaText = schemaText.replace(/\s*=\s*{};/g, ';');
  schemaText = schemaText.replace(/{ /g, '{\n ');
  schemaText = schemaText.replace(/\n\s*"/g, '\n  "');
  schemaText = schemaText.replace(/Set < (.+?) >/g, 'Set<$1>');
  schemaText = schemaText.replace(/{(type|entity|action)/g, '{\n$1');
  schemaText = schemaText.replace(/"\]appliesTo/g, '"] appliesTo');

  return schemaText;
};
