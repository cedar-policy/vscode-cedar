// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// how the Cedar CLI is labeled in the UI, including the terminal it runs in
export const CEDAR_CLI_LABEL = 'Cedar CLI';

/**
 * `cedar --version` reports `cedar-policy-cli 4.13.0`, so just the version is
 * kept and relabeled in the style of the other About details.
 */
export const cedarCLIDetail = (stdout: string): string | undefined => {
  const [name, version] = stdout.trim().split(/\s+/);

  return name && version ? `${CEDAR_CLI_LABEL}: ${version}` : undefined;
};

/*
 * The Cedar CLI is optional and not used by the extension, so it is only
 * reported when found on the PATH of the extension host.
 */
let cedarCLI: string | undefined = undefined;

export const detectCedarCLI = async (): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('cedar', ['--version'], {
      timeout: 5000,
    });
    cedarCLI = cedarCLIDetail(stdout);
  } catch {
    // `cedar` is not installed, or not on the PATH
    cedarCLI = undefined;
  }

  // menus and commands which run the Cedar CLI are gated on this context key
  await vscode.commands.executeCommand(
    'setContext',
    'cedar.cedarcli',
    cedarCLI !== undefined,
  );

  return cedarCLI;
};

export async function aboutExtension(
  context: vscode.ExtensionContext,
): Promise<void> {
  // detect again, in case the Cedar CLI was installed after activation
  await detectCedarCLI();

  const pkg = context.extension.packageJSON;
  const extensionDetails =
    `${pkg.publisher}.${pkg.name}: ${pkg.version}\n` +
    `Cedar SDK: ${cedar.getCedarSDKVersion()}\n` +
    (cedarCLI ? `${cedarCLI}\n` : '') +
    `Visual Studio Code: ${vscode.version}\n` +
    (process.versions.node ? `node: ${process.versions.node}\n` : '');

  const result = await vscode.window.showInformationMessage(
    extensionDetails,
    { modal: true },
    'Copy',
  );
  if (result === 'Copy') {
    void vscode.env.clipboard.writeText(extensionDetails);
  }
}
