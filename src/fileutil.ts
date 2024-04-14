// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import { addValidationDiagnosticInfo } from './diagnostics';

const CEDAR_SCHEMA_FILE = `cedarschema.json`;
const CEDAR_SCHEMA_EXTENSION_JSON = `.cedarschema.json`;
const CEDAR_SCHEMA_EXTENSION = `.cedarschema`; // https://github.com/cedar-policy/rfcs/blob/schema-syntax/text/0024-schema-syntax.md
export const CEDAR_SCHEMA_GLOB = `{**/cedarschema.json,**/*.cedarschema.json}`;

const CEDAR_ENTITIES_FILE = `cedarentities.json`;
const CEDAR_ENTITIES_EXTENSION_JSON = `.cedarentities.json`;
export const CEDAR_ENTITIES_GLOB = `{**/cedarentities.json,**/*.cedarentities.json,**/avpentities.json,**/*.avpentities.json}`;

export const CEDAR_TEMPLATELINKS_GLOB = `{**/cedartemplatelinks.json,**/*.cedartemplatelinks.json,**/cedarlinks.json,**/*.cedarlinks.json}`;
export const CEDAR_AUTH_GLOB = `{**/cedarauth.json,**/*.cedarauth.json,**/cedarparc.json,**/*.cedarparc.json}`;
export const CEDAR_JSON_GLOB = `**/*.cedar.json`;

export const detectSchemaDoc = (doc: vscode.TextDocument): boolean => {
  const result =
    doc.fileName.endsWith(path.sep + CEDAR_SCHEMA_FILE) ||
    doc.fileName.endsWith(CEDAR_SCHEMA_EXTENSION_JSON);

  return result;
};

export const detectEntitiesDoc = (doc: vscode.TextDocument): boolean => {
  const result =
    doc.fileName.endsWith(path.sep + CEDAR_ENTITIES_FILE) ||
    doc.fileName.endsWith(CEDAR_ENTITIES_EXTENSION_JSON);

  return result;
};

export const findSchemaFilesInFolder = async (filepath: string) => {
  const schemaFiles = [];
  const files = await vscode.workspace.fs.readDirectory(
    vscode.Uri.file(filepath)
  );

  for (const file of files) {
    if (
      file[1] === vscode.FileType.File &&
      (file[0] === CEDAR_SCHEMA_FILE ||
        file[0].endsWith(CEDAR_SCHEMA_EXTENSION_JSON))
    ) {
      schemaFiles.push(file[0]);
    }
  }

  return schemaFiles;
};

export const handleDidRenameFiles = async (
  e: vscode.FileRenameEvent,
  diagnosticCollection: vscode.DiagnosticCollection
) => {
  e.files.forEach(async (file) => {
    if (
      (await vscode.workspace.fs.stat(file.newUri)).type ===
      vscode.FileType.Directory
    ) {
      diagnosticCollection.forEach((uri) => {
        if (uri.path.startsWith(file.oldUri.path)) {
          const newUri = vscode.Uri.file(
            uri.path.replace(file.oldUri.path, file.newUri.path)
          );
          diagnosticCollection.set(newUri, diagnosticCollection.get(uri));
          diagnosticCollection.delete(uri);
        }
      });
    } else if (diagnosticCollection.has(file.oldUri)) {
      diagnosticCollection.set(
        file.newUri,
        diagnosticCollection.get(file.oldUri)
      );
      diagnosticCollection.delete(file.oldUri);
    }
  });
};

export const handleWillDeleteFiles = async (
  e: vscode.FileDeleteEvent,
  diagnosticCollection: vscode.DiagnosticCollection
) => {
  e.files.forEach(async (file) => {
    if (
      (await vscode.workspace.fs.stat(file)).type === vscode.FileType.Directory
    ) {
      diagnosticCollection.forEach((uri) => {
        if (uri.fsPath.startsWith(file.fsPath)) {
          diagnosticCollection.delete(uri);
        }
      });
    } else if (diagnosticCollection.has(file)) {
      diagnosticCollection.delete(file);
    }
  });
};

export const getSchemaUri = async (
  doc: vscode.TextDocument | undefined = undefined
): Promise<vscode.Uri | undefined> => {
  let fileUri = undefined;
  const config = vscode.workspace.getConfiguration('cedar');
  const schemaFile = config.get<string>('schemaFile', '');
  if (
    schemaFile &&
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
  ) {
    fileUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders[0].uri,
      schemaFile
    );
  }

  const autodetect = config.get<boolean>('autodetectSchemaFile', true);
  if (doc && autodetect) {
    const cedarDocPath = path.dirname(doc.uri.fsPath);
    const files = await findSchemaFilesInFolder(cedarDocPath);
    if (files && files.length === 1) {
      fileUri = vscode.Uri.file(path.join(cedarDocPath, files[0]));
    } else {
      const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (workspace?.uri) {
        const files = await findSchemaFilesInFolder(workspace.uri.fsPath);
        if (files && files.length === 1) {
          fileUri = vscode.Uri.file(path.join(workspace.uri.fsPath, files[0]));
        }
      }
    }
  }

  return Promise.resolve(fileUri);
};

export const getSchemaTextDocument = async (
  doc: vscode.TextDocument | undefined = undefined
): Promise<vscode.TextDocument | undefined> => {
  let schemaDoc = undefined;
  const fileUri = await getSchemaUri(doc);
  if (fileUri) {
    try {
      schemaDoc = await vscode.workspace.openTextDocument(fileUri);
    } catch {
      vscode.window.showErrorMessage(`Missing cedar.schemaFile: ${fileUri}`);
    }
  }

  return Promise.resolve(schemaDoc);
};
