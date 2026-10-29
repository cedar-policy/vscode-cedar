// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import { getCedarTestFiles, getSchemaTextDocument } from './fileutil';
import { CEDAR_CLI_LABEL } from './about';
import { getMaxLevel } from './validate';

/*
 * Run the optional Cedar CLI (the cedar-policy-cli crate) in a terminal.  The
 * extension validates in process using vscode-cedar-wasm, so these commands
 * are a way to reproduce a result on the command line, and are only offered
 * when `cedar` was detected (the cedar.cedarcli context key).
 */

const CEDAR_CLI = 'cedar';

export type CedarCLICommand =
  | 'validate'
  | 'run-tests'
  | 'check-parse-schema'
  | 'check-parse-entities'
  | 'authorize';

// the folder the Cedar CLI runs in, so the arguments can be relative paths
const cedarCLICwd = (doc: vscode.TextDocument): string =>
  vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ||
  path.dirname(doc.uri.fsPath);

let cliTerminal: vscode.Terminal | undefined = undefined;
let cliTerminalCwd: string | undefined = undefined;

/*
 * A single terminal is reused for every Cedar CLI command, and recreated when
 * the user closes it or when the folder to run in changes
 */
const cedarCLITerminal = (
  context: vscode.ExtensionContext,
  cwd: string,
): vscode.Terminal => {
  if (
    cliTerminal &&
    cliTerminalCwd === cwd &&
    vscode.window.terminals.includes(cliTerminal)
  ) {
    return cliTerminal;
  }

  cliTerminal?.dispose();
  cliTerminal = vscode.window.createTerminal({
    name: CEDAR_CLI_LABEL,
    cwd: cwd,
    iconPath: vscode.Uri.joinPath(
      context.extensionUri,
      'icons',
      'Cedar_16.svg',
    ),
    isTransient: true, // don't restore the terminal when the window reloads
  });
  cliTerminalCwd = cwd;
  context.subscriptions.push(cliTerminal);

  return cliTerminal;
};

// a file argument, relative to the folder the Cedar CLI runs in
const fileArg = (cwd: string, uri: vscode.Uri): string => {
  const relative = path.relative(cwd, uri.fsPath);
  const value = relative.startsWith('..') ? uri.fsPath : relative;

  // double quotes are understood by POSIX shells, PowerShell, and cmd.exe
  return /^[\w./\\:-]+$/.test(value) ? value : `"${value}"`;
};

// the Cedar CLI defaults to the Cedar schema format
const schemaFormatArgs = (schemaDoc: vscode.TextDocument): string[] =>
  schemaDoc.languageId === 'cedarschema' ? [] : ['--schema-format', 'json'];

const schemaArgs = async (
  doc: vscode.TextDocument,
  cwd: string,
): Promise<string[]> => {
  const schemaDoc = await getSchemaTextDocument(doc);

  return schemaDoc
    ? ['-s', fileArg(cwd, schemaDoc.uri), ...schemaFormatArgs(schemaDoc)]
    : [];
};

/*
 * The Cedar CLI reads policies from a single file, while the extension
 * evaluates every Cedar policy file it finds alongside a document, so ask
 * which one to use when there is more than one
 */
const policyArgs = async (
  policyDocs: vscode.TextDocument[],
  cwd: string,
): Promise<string[] | undefined> => {
  if (policyDocs.length === 0) {
    void vscode.window.showErrorMessage(
      'No Cedar policy (*.cedar) file found alongside this file',
    );
    return undefined;
  }

  let policyDoc: vscode.TextDocument | undefined = policyDocs[0];
  if (policyDocs.length > 1) {
    const items: vscode.QuickPickItem[] = policyDocs.map((doc) => ({
      label: path.basename(doc.uri.fsPath),
      description: fileArg(cwd, doc.uri),
    }));
    const result = await vscode.window.showQuickPick(items, {
      title: 'Run Cedar CLI with policies',
    });
    policyDoc = result
      ? policyDocs.find((doc) => path.basename(doc.uri.fsPath) === result.label)
      : undefined;
  }

  return policyDoc ? ['-p', fileArg(cwd, policyDoc.uri)] : undefined;
};

const templateLinksArgs = (
  templateLinksDoc: vscode.TextDocument | undefined,
  cwd: string,
): string[] =>
  templateLinksDoc ? ['-k', fileArg(cwd, templateLinksDoc.uri)] : [];

const cedarCLIArgs = async (
  command: CedarCLICommand,
  doc: vscode.TextDocument,
  cwd: string,
): Promise<string[] | undefined> => {
  const file = fileArg(cwd, doc.uri);

  switch (command) {
    case 'validate': {
      const schema = await schemaArgs(doc, cwd);
      if (schema.length === 0) {
        void vscode.window.showErrorMessage(
          'No Cedar schema found to validate against',
        );
        return undefined;
      }
      const { templateLinksDoc } = await getCedarTestFiles(doc);
      const maxLevel = getMaxLevel(doc);

      return [
        'validate',
        ...schema,
        '-p',
        file,
        ...templateLinksArgs(templateLinksDoc, cwd),
        ...(maxLevel !== undefined ? ['--level', `${maxLevel}`] : []),
      ];
    }

    case 'run-tests': {
      const { policyDocs, templateLinksDoc } = await getCedarTestFiles(doc);
      const policies = await policyArgs(policyDocs, cwd);
      if (!policies) {
        return undefined;
      }

      return [
        'run-tests',
        '--tests',
        file,
        ...policies,
        ...templateLinksArgs(templateLinksDoc, cwd),
        ...(await schemaArgs(doc, cwd)),
      ];
    }

    // the document is the schema, so it doesn't need to be discovered
    case 'check-parse-schema':
      return ['check-parse', '-s', file, ...schemaFormatArgs(doc)];

    case 'check-parse-entities':
      return [
        'check-parse',
        '--entities',
        file,
        ...(await schemaArgs(doc, cwd)),
      ];

    case 'authorize': {
      const { policyDocs, templateLinksDoc, entitiesDoc } =
        await getCedarTestFiles(doc);
      if (!entitiesDoc) {
        void vscode.window.showErrorMessage(
          'No Cedar entities file found alongside this file',
        );
        return undefined;
      }
      const policies = await policyArgs(policyDocs, cwd);
      if (!policies) {
        return undefined;
      }

      return [
        'authorize',
        '--request-json',
        file,
        '--entities',
        fileArg(cwd, entitiesDoc.uri),
        ...policies,
        ...templateLinksArgs(templateLinksDoc, cwd),
        ...(await schemaArgs(doc, cwd)),
        '--verbose',
      ];
    }
  }
};

// the command line run in the terminal, or undefined when a file is missing
export const cedarCLICommandLine = async (
  command: CedarCLICommand,
  doc: vscode.TextDocument,
): Promise<string | undefined> => {
  const args = await cedarCLIArgs(command, doc, cedarCLICwd(doc));

  return args ? [CEDAR_CLI, ...args].join(' ') : undefined;
};

export const runCedarCLI = async (
  context: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  command: CedarCLICommand,
): Promise<boolean> => {
  const commandLine = await cedarCLICommandLine(command, doc);
  if (!commandLine) {
    return false;
  }

  const terminal = cedarCLITerminal(context, cedarCLICwd(doc));
  terminal.show();
  terminal.sendText(commandLine);

  return true;
};
