// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as cedar from 'vscode-cedar-wasm';

const packageJsonFile = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
const packageVersion = `${packageJson.publisher}.${packageJson.name}: ${packageJson.version}\n`;
const vsCodeVersion = `Visual Studio Code: ${vscode.version}\n`;
const nodeVersion = process.versions.node
  ? `node: ${process.versions.node}\n`
  : '';

export async function aboutExtension(): Promise<void> {
  const extensionDetails =
    packageVersion +
    `Cedar: ${cedar.getCedarVersion()}\n` +
    vsCodeVersion +
    nodeVersion;

  const result = await vscode.window.showInformationMessage(
    extensionDetails,
    { modal: true },
    'Copy'
  );
  if (result === 'Copy') {
    void vscode.env.clipboard.writeText(extensionDetails);
  }
}
