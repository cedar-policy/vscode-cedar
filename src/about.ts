// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';

export async function aboutExtension(context: vscode.ExtensionContext): Promise<void> {
  const pkg = context.extension.packageJSON;
  const extensionDetails =
    `${pkg.publisher}.${pkg.name}: ${pkg.version}\n` +
    `Cedar SDK: ${cedar.getCedarSDKVersion()}\n` +
    `Visual Studio Code: ${vscode.version}\n` +
    (process.versions.node ? `node: ${process.versions.node}\n` : '');

  const result = await vscode.window.showInformationMessage(
    extensionDetails,
    { modal: true },
    'Copy'
  );
  if (result === 'Copy') {
    void vscode.env.clipboard.writeText(extensionDetails);
  }
}
