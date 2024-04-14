// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import { parseCedarPoliciesDoc } from './parser';

export const getPolicyQuickPickItems = (
  cedarDoc: vscode.TextDocument,
  selection: vscode.Range
): vscode.QuickPickItem[] => {
  const items: vscode.QuickPickItem[] = [];
  const policyRanges = parseCedarPoliciesDoc(cedarDoc).policies;
  policyRanges.forEach((policyRange, index) => {
    const item: vscode.QuickPickItem = {
      label: policyRange.id,
      detail: cedarDoc.uri.path
        .substring(cedarDoc.uri.path.lastIndexOf('/') + 1)
        .replace(/\.cedar$/, `(${policyRange.id}).cedar.json`),
    };
    if (policyRange.range.intersection(selection)) {
      // if selection range intersects with policy, pre-select in pick list
      item.picked = true;
    }
    items.push(item);
  });
  return items;
};

export const exportCedarDocPolicyById = async (
  cedarDoc: vscode.TextDocument,
  policyId: string,
  exportFilename: string
): Promise<string> => {
  let exportJson = '';
  const policyRanges = parseCedarPoliciesDoc(cedarDoc).policies;
  policyRanges.forEach((policyRange, index) => {
    if (policyRange.id === policyId) {
      const rawPolicy = cedarDoc.getText(policyRange.range);
      const isTemplate =
        rawPolicy.includes('?principal') || rawPolicy.includes('?resource');
      let exportResult: cedar.ExportPolicyResult;
      if (isTemplate) {
        exportResult = cedar.exportPolicyTemplate(rawPolicy);
      } else {
        exportResult = cedar.exportPolicy(rawPolicy);
      }
      let success = exportResult.success;
      if (success && exportResult.json) {
        exportJson = JSON.stringify(JSON.parse(exportResult.json), null, 2);

        vscode.workspace.fs.writeFile(
          vscode.Uri.file(exportFilename),
          new Uint8Array(Buffer.from(exportJson))
        );
      }

      exportResult.free();
      return Promise.resolve(exportJson);
    }
  });

  return Promise.resolve(exportJson);
};
