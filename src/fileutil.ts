// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';

const CEDAR_EXTENSION = `.cedar`;

const CEDAR_SCHEMA_FILE = `cedarschema`;
const CEDAR_SCHEMA_EXTENSION = `.cedarschema`;

/*
 * Cedar JSON file kinds, which are also the values of the
 * cedar.fileAssociations setting
 */

export type CedarKind =
  | 'cedarschema.json'
  | 'cedarentities'
  | 'avpentities'
  | 'cedartemplatelinks'
  | 'cedarauth'
  | 'cedartests'
  | 'cedar.json';

// the filenames each kind is detected by, without a configured association
const BUILTIN_FILENAMES: Record<CedarKind, string[]> = {
  'cedarschema.json': ['cedarschema.json', '*.cedarschema.json'],
  cedarentities: ['cedarentities.json', '*.cedarentities.json'],
  avpentities: ['avpentities.json', '*.avpentities.json'],
  cedartemplatelinks: [
    'cedartemplatelinks.json',
    '*.cedartemplatelinks.json',
    'cedarlinks.json',
    '*.cedarlinks.json',
  ],
  cedarauth: [
    'cedarauth.json',
    '*.cedarauth.json',
    'cedarparc.json',
    '*.cedarparc.json',
  ],
  cedartests: ['cedartests.json', '*.cedartests.json'],
  'cedar.json': ['*.cedar.json'],
};

export const CEDAR_KINDS = Object.keys(BUILTIN_FILENAMES) as CedarKind[];

// a pattern without a path separator matches that filename in any folder, the
// same as the files.associations setting
const toGlobPattern = (pattern: string): string =>
  pattern.startsWith('**') || pattern.startsWith('/')
    ? pattern
    : `**/${pattern}`;

const toGlob = (patterns: string[]): string =>
  patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;

/**
 * The `cedar.fileAssociations` setting, which maps a glob pattern to a Cedar
 * JSON file kind for users whose files don't follow the `cedar*.json` naming
 * convention.  Unrecognized kinds are ignored.
 */
const getFileAssociations = (
  doc: vscode.TextDocument | undefined = undefined,
): [string, CedarKind][] =>
  Object.entries(
    vscode.workspace
      .getConfiguration('cedar', doc?.uri)
      .get<Record<string, string>>('fileAssociations', {}),
  ).filter(([, kind]) => CEDAR_KINDS.includes(kind as CedarKind)) as [
    string,
    CedarKind,
  ][];

const configuredPatterns = (
  kind: CedarKind,
  doc: vscode.TextDocument | undefined = undefined,
): string[] =>
  getFileAssociations(doc)
    .filter(([, value]) => value === kind)
    .map(([pattern]) => toGlobPattern(pattern));

/**
 * Glob for a Cedar JSON file kind, combining the built-in filenames with any
 * `cedar.fileAssociations` patterns.  Used for document selectors, which only
 * accept a static glob, and for `findFiles` and file watchers.
 */
export const cedarKindGlob = (
  kind: CedarKind | CedarKind[],
  doc: vscode.TextDocument | undefined = undefined,
): string => {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const patterns = new Set<string>();
  kinds.forEach((k) => {
    BUILTIN_FILENAMES[k].forEach((filename) =>
      patterns.add(toGlobPattern(filename)),
    );
    configuredPatterns(k, doc).forEach((pattern) => patterns.add(pattern));
  });

  return toGlob(Array.from(patterns));
};

/**
 * Determine which kind of Cedar JSON file a document is, from the built-in
 * filenames first, then the `cedar.fileAssociations` setting in declaration
 * order.  Returns `undefined` for any other document.
 */
export const determineCedarKind = (
  doc: vscode.TextDocument,
): CedarKind | undefined => {
  for (const kind of CEDAR_KINDS) {
    const glob = toGlob(BUILTIN_FILENAMES[kind].map(toGlobPattern));
    if (vscode.languages.match({ pattern: glob }, doc) > 0) {
      return kind;
    }
  }

  for (const [pattern, kind] of getFileAssociations(doc)) {
    if (vscode.languages.match({ pattern: toGlobPattern(pattern) }, doc) > 0) {
      return kind;
    }
  }

  return undefined;
};

/**
 * Match a filename against the built-in filenames for a Cedar JSON file kind
 * and any `cedar.fileAssociations` patterns.  Only the last segment of a
 * pattern is used, since this discovers files already known to be in a folder
 * alongside another Cedar file.
 */
const cedarKindFilenameMatcher = (
  kind: CedarKind | CedarKind[],
  doc: vscode.TextDocument | undefined = undefined,
): ((filename: string) => boolean) => {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const regexes = kinds.flatMap((k) =>
    [...BUILTIN_FILENAMES[k], ...configuredPatterns(k, doc)].map((pattern) => {
      const name = pattern.substring(pattern.lastIndexOf('/') + 1);
      return new RegExp(
        `^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      );
    }),
  );

  return (filename: string) => regexes.some((regex) => regex.test(filename));
};

export const detectSchemaDoc = (doc: vscode.TextDocument): boolean => {
  const result =
    doc.languageId === 'cedarschema' ||
    determineCedarKind(doc) === 'cedarschema.json';

  return result;
};

export const detectEntitiesDoc = (doc: vscode.TextDocument): boolean => {
  const kind = determineCedarKind(doc);
  const result = kind === 'cedarentities' || kind === 'avpentities';

  return result;
};

export const detectTestsDoc = (doc: vscode.TextDocument): boolean => {
  const result = determineCedarKind(doc) === 'cedartests';

  return result;
};

// read a folder and return the names of the files matching a predicate
const findFileNamesInFolder = async (
  filepath: string,
  matches: (filename: string) => boolean,
): Promise<string[]> => {
  let files: [string, vscode.FileType][] = [];
  try {
    files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(filepath));
  } catch {
    // folder cannot be read, such as a document outside of the filesystem
    return Promise.resolve([]);
  }

  return Promise.resolve(
    files
      .filter((file) => file[1] === vscode.FileType.File && matches(file[0]))
      .map((file) => file[0]),
  );
};

const findSchemaFilesInFolder = async (
  filepath: string,
  doc: vscode.TextDocument | undefined = undefined,
): Promise<string[]> => {
  // first find Cedar schema files
  const schemaFiles = new Set<string>(
    await findFileNamesInFolder(
      filepath,
      (filename) =>
        filename === CEDAR_SCHEMA_FILE ||
        filename.endsWith(CEDAR_SCHEMA_EXTENSION),
    ),
  );

  // then look for Cedar schema JSON files that aren't translated versions
  const schemaJsonFiles = await findFileNamesInFolder(
    filepath,
    cedarKindFilenameMatcher('cedarschema.json', doc),
  );
  schemaJsonFiles.forEach((filename) => {
    if (!schemaFiles.has(filename.substring(0, filename.length - 5))) {
      // .json
      schemaFiles.add(filename);
    }
  });

  return Promise.resolve(Array.from(schemaFiles));
};

export const handleDidRenameFiles = async (
  e: vscode.FileRenameEvent,
  diagnosticCollection: vscode.DiagnosticCollection,
) => {
  await Promise.all(
    e.files.map(async (file) => {
      if (
        (await vscode.workspace.fs.stat(file.newUri)).type ===
        vscode.FileType.Directory
      ) {
        diagnosticCollection.forEach((uri) => {
          if (uri.path.startsWith(file.oldUri.path)) {
            const newUri = vscode.Uri.file(
              uri.path.replace(file.oldUri.path, file.newUri.path),
            );
            diagnosticCollection.set(newUri, diagnosticCollection.get(uri));
            diagnosticCollection.delete(uri);
          }
        });
      } else if (diagnosticCollection.has(file.oldUri)) {
        diagnosticCollection.set(
          file.newUri,
          diagnosticCollection.get(file.oldUri),
        );
        diagnosticCollection.delete(file.oldUri);
      }
    }),
  );
};

export const handleWillDeleteFiles = async (
  e: vscode.FileDeleteEvent,
  diagnosticCollection: vscode.DiagnosticCollection,
) => {
  await Promise.all(
    e.files.map(async (file) => {
      if (
        (await vscode.workspace.fs.stat(file)).type ===
        vscode.FileType.Directory
      ) {
        diagnosticCollection.forEach((uri) => {
          if (uri.fsPath.startsWith(file.fsPath)) {
            diagnosticCollection.delete(uri);
          }
        });
      } else if (diagnosticCollection.has(file)) {
        diagnosticCollection.delete(file);
      }
    }),
  );
};

export const getSchemaUri = async (
  doc: vscode.TextDocument | undefined = undefined,
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
      schemaFile,
    );
  }

  const autodetect = config.get<boolean>('autodetectSchemaFile', true);
  if (doc && autodetect) {
    const cedarDocPath = path.dirname(doc.uri.fsPath);
    const files = await findSchemaFilesInFolder(cedarDocPath, doc);
    if (files.length === 1) {
      fileUri = vscode.Uri.file(path.join(cedarDocPath, files[0]));
    } else {
      const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (workspace?.uri) {
        const files = await findSchemaFilesInFolder(workspace.uri.fsPath, doc);
        if (files.length === 1) {
          fileUri = vscode.Uri.file(path.join(workspace.uri.fsPath, files[0]));
        }
      }
    }
  }

  return Promise.resolve(fileUri);
};

export const getSchemaTextDocument = async (
  doc: vscode.TextDocument | undefined = undefined,
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

// look next to doc first, then fallback to the workspace folder
const findRelatedFiles = async (
  doc: vscode.TextDocument,
  matches: (filename: string) => boolean,
): Promise<string[]> => {
  const folders = [path.dirname(doc.uri.fsPath)];
  const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (workspace?.uri) {
    folders.push(workspace.uri.fsPath);
  }

  for (const folder of folders) {
    const filenames = await findFileNamesInFolder(folder, matches);
    if (filenames.length > 0) {
      return Promise.resolve(
        filenames.map((filename) => path.join(folder, filename)),
      );
    }
  }

  return Promise.resolve([]);
};

const openTextDocuments = async (
  filepaths: string[],
): Promise<vscode.TextDocument[]> => {
  const docs: vscode.TextDocument[] = [];
  for (const filepath of filepaths) {
    try {
      docs.push(
        await vscode.workspace.openTextDocument(vscode.Uri.file(filepath)),
      );
    } catch {
      // skip files which cannot be opened
    }
  }

  return Promise.resolve(docs);
};

export type CedarTestFiles = {
  schemaDoc: vscode.TextDocument | undefined;
  policyDocs: vscode.TextDocument[];
  templateLinksDoc: vscode.TextDocument | undefined;
  entitiesDoc: vscode.TextDocument | undefined;
};

/**
 * Locate the Cedar files a Cedar tests file is evaluated against.  Policies,
 * template links, and (fallback) entities are discovered by naming convention
 * (or `cedar.fileAssociations`) in the folder containing the tests file, then
 * in the workspace folder.
 */
export const getCedarTestFiles = async (
  testsDoc: vscode.TextDocument,
): Promise<CedarTestFiles> => {
  const [schemaDoc, policyDocs, templateLinksDocs, entitiesDocs] =
    await Promise.all([
      getSchemaTextDocument(testsDoc),
      findRelatedFiles(testsDoc, (filename) =>
        filename.endsWith(CEDAR_EXTENSION),
      ).then(openTextDocuments),
      findRelatedFiles(
        testsDoc,
        cedarKindFilenameMatcher('cedartemplatelinks', testsDoc),
      ).then(openTextDocuments),
      findRelatedFiles(
        testsDoc,
        cedarKindFilenameMatcher('cedarentities', testsDoc),
      ).then(openTextDocuments),
    ]);

  return Promise.resolve({
    schemaDoc: schemaDoc,
    // exclude exported single policy JSON (*.cedar.json) companions
    policyDocs: policyDocs.filter((doc) => doc.languageId === 'cedar'),
    templateLinksDoc: templateLinksDocs[0],
    entitiesDoc: entitiesDocs[0],
  });
};

const getJsonIndentSize = (): number => {
  const config = vscode.workspace.getConfiguration('editor', {
    languageId: 'json',
  });
  return config.get<number>('tabSize', 2);
};

const formatJsonText = (text: string): string => {
  try {
    const parsed = JSON.parse(text);
    const indentSize = getJsonIndentSize();
    return JSON.stringify(parsed, null, indentSize);
  } catch {
    return text; // Return original if not valid JSON
  }
};

export const saveTextAndFormat = async (
  uri: vscode.Uri,
  text: string,
): Promise<boolean> => {
  let targetUri = uri;

  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    // File doesn't exist, prompt user
    const saveUri = await vscode.window.showSaveDialog({ defaultUri: uri });
    if (!saveUri) {
      return false;
    }
    targetUri = saveUri;
  }

  // Format JSON text with user's indent settings if it's a JSON file
  let formattedText = text;
  if (targetUri.path.endsWith('.json')) {
    formattedText = formatJsonText(text);
  }

  let doc = null;
  try {
    doc = await vscode.workspace.openTextDocument(targetUri);
  } catch {
    // File doesn't exist yet
  }
  if (doc) {
    // File exists, use workspace edit
    const edit = new vscode.WorkspaceEdit();
    const fullRange = doc.validateRange(
      new vscode.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE),
    );
    edit.replace(targetUri, fullRange, formattedText);
    await vscode.workspace.applyEdit(edit);
  } else {
    // New file, write directly
    await vscode.workspace.fs.writeFile(
      targetUri,
      new Uint8Array(Buffer.from(formattedText)),
    );
  }

  await vscode.commands.executeCommand('vscode.open', targetUri);
  const textEdits: vscode.TextEdit[] = await vscode.commands.executeCommand(
    'vscode.executeFormatDocumentProvider',
    targetUri,
  );
  const workEdits = new vscode.WorkspaceEdit();
  workEdits.set(targetUri, textEdits);
  await vscode.workspace.applyEdit(workEdits);
  const savedDoc = await vscode.workspace.openTextDocument(targetUri);
  return await savedDoc.save();
};
