// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  getLevelDisplay,
  getMaxLevel,
  getPolicyLevels,
  onDidChangePolicyLevels,
} from './validate';

/*
 * The level each Cedar policy validates at (RFC 76), which is only known after
 * the document validates against a Cedar schema
 */

const LEVEL_VALIDATION_URI = vscode.Uri.parse(
  'https://docs.cedarpolicy.com/policies/level-validation.html',
  true,
);

const describeLevel = (
  level: number | undefined,
  maxLevel: number | undefined,
): { label: string; tooltip: string } => {
  if (level === undefined) {
    return {
      label: 'Level: none',
      tooltip:
        'Dereferences an entity literal, which is not allowed at any level',
    };
  } else if (maxLevel !== undefined && level > maxLevel) {
    return {
      label: `Level ${level}`,
      tooltip: `Requires entity dereference level ${level}, which exceeds cedar.levelValidation.maxLevel (${maxLevel})`,
    };
  }
  return {
    label: `Level ${level}`,
    tooltip: `Validates at entity dereference level ${level}`,
  };
};

const openDocsCommand = (title: string, tooltip: string): vscode.Command => ({
  command: 'vscode.open',
  title: title,
  tooltip: `${tooltip}\nOpen ${LEVEL_VALIDATION_URI.toString()}`,
  arguments: [LEVEL_VALIDATION_URI],
});

export class PolicyLevelCodeLensProvider implements vscode.CodeLensProvider {
  onDidChangeCodeLenses = onDidChangePolicyLevels;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (getLevelDisplay(document) !== 'codeLens') {
      return [];
    }

    const maxLevel = getMaxLevel(document);
    return getPolicyLevels(document).map(({ effectRange, level }) => {
      const { label, tooltip } = describeLevel(level, maxLevel);
      return new vscode.CodeLens(effectRange, openDocsCommand(label, tooltip));
    });
  }
}

/*
 * The position just after the `;` ending a policy, ignoring any trailing
 * comment, or the end of the line when the policy is unterminated
 */
const policyEndPosition = (
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Position => {
  const text = document.lineAt(range.end.line).text;
  const commentPos = text.indexOf('//');
  const semicolonPos = text.lastIndexOf(
    ';',
    commentPos > -1 ? commentPos : text.length,
  );
  return new vscode.Position(
    range.end.line,
    semicolonPos > -1 ? semicolonPos + 1 : text.length,
  );
};

export class PolicyLevelInlayHintsProvider
  implements vscode.InlayHintsProvider
{
  onDidChangeInlayHints = onDidChangePolicyLevels;

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    if (getLevelDisplay(document) !== 'inlayHint') {
      return [];
    }

    const maxLevel = getMaxLevel(document);
    return getPolicyLevels(document)
      .filter((policyLevel) => range.intersection(policyLevel.range))
      .map(({ range, level }) => {
        const { label, tooltip } = describeLevel(level, maxLevel);
        // a command would be shown in the hover as "Execute Command", so link
        // to the external docs from the tooltip instead
        const labelPart = new vscode.InlayHintLabelPart(`// ${label}`);
        labelPart.tooltip = new vscode.MarkdownString()
          .appendText(tooltip)
          .appendMarkdown(
            `\n\n[Open ${LEVEL_VALIDATION_URI.toString()}](${LEVEL_VALIDATION_URI.toString()})`,
          );

        const hint = new vscode.InlayHint(policyEndPosition(document, range), [
          labelPart,
        ]);
        hint.paddingLeft = true;
        return hint;
      });
  }
}
