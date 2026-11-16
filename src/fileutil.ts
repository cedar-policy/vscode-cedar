// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as cedar from 'vscode-cedar-wasm';

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

/*
 * Cedar schema sets
 *
 * Every Cedar schema file found alongside a document (or in the workspace
 * folder, or listed by `cedar.schemaFile`) is combined into one schema.  When
 * any of them declares an `external` entity type or action they are linked,
 * otherwise they are merged as fragments of one schema.  The combined schema
 * is a read-only JSON document, so features expecting one schema document work
 * the same for a single schema file or a set of them.
 */

export const CEDAR_SCHEMA_SCHEME = 'cedar-schema';
const COMBINED_SCHEMA_FILE = 'combined.cedarschema.json';

export type CedarSchemaSet = {
  // the schema files, sorted by path
  docs: vscode.TextDocument[];
  // listed by the cedar.schemaFile setting, rather than autodetected
  configured: boolean;
  // the result of combining more than one schema file
  link?: {
    success: boolean;
    mode: 'merge' | 'link';
    complete: boolean;
    externalEntityTypes: string[];
    externalActions: string[];
    errors: cedar.LinkSchemaMessage[];
    warnings: cedar.LinkSchemaMessage[];
  };
  // the schema used for validation, which is the only schema file or the
  // combined schema, or undefined when the schema files could not be combined
  doc: vscode.TextDocument | undefined;
};

// the content of each combined schema document, and the schema files in it
const combinedSchemas: Record<string, { text: string; uris: string[] }> = {};

// forget the previous combined schemas of the same schema files, unless shown
const pruneCombinedSchemas = (latest: vscode.Uri, uris: string[]) => {
  const key = uris.join('\n');
  const shown = new Set(
    vscode.window.visibleTextEditors.map((editor) =>
      editor.document.uri.toString(),
    ),
  );
  Object.entries(combinedSchemas).forEach(([uri, combined]) => {
    if (
      uri !== latest.toString() &&
      combined.uris.join('\n') === key &&
      !shown.has(uri)
    ) {
      delete combinedSchemas[uri];
    }
  });
};

export const combinedSchemaContentProvider: vscode.TextDocumentContentProvider =
  {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return combinedSchemas[uri.toString()]?.text || '';
    },
  };

export const isCombinedSchemaDoc = (doc: vscode.TextDocument): boolean =>
  doc.uri.scheme === CEDAR_SCHEMA_SCHEME;

/**
 * The URIs of the schema files in a schema, which is just the schema itself
 * unless it is a combined schema.
 */
export const getSchemaMemberUris = (schemaDoc: vscode.TextDocument): string[] =>
  combinedSchemas[schemaDoc.uri.toString()]?.uris || [schemaDoc.uri.toString()];

const GLOB_CHARS = /[*?{}[\]]/;

// remove a translated foo.cedarschema.json when foo.cedarschema is present
const withoutTranslatedSchemas = (uris: vscode.Uri[]): vscode.Uri[] => {
  const paths = new Set(uris.map((uri) => uri.path));
  return uris.filter(
    (uri) =>
      !(
        uri.path.endsWith(`${CEDAR_SCHEMA_EXTENSION}.json`) &&
        paths.has(uri.path.substring(0, uri.path.length - 5))
      ),
  );
};

const sortUris = (uris: vscode.Uri[]): vscode.Uri[] =>
  uris.sort((a, b) => a.path.localeCompare(b.path));

/**
 * The `cedar.schemaFile` setting, relative to the first workspace folder.  A
 * string is a single schema file path, exactly as before schema sets.  An
 * array lists schema file paths or glob patterns, all combined into one set.
 */
const getConfiguredSchemaUris = async (): Promise<vscode.Uri[]> => {
  const schemaFile = vscode.workspace
    .getConfiguration('cedar')
    .get<string | string[]>('schemaFile', '');
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!schemaFile || !folder) {
    return Promise.resolve([]);
  }

  if (typeof schemaFile === 'string') {
    return Promise.resolve([vscode.Uri.joinPath(folder.uri, schemaFile)]);
  }

  const uris: vscode.Uri[] = [];
  for (const entry of schemaFile) {
    if (typeof entry !== 'string' || entry.length === 0) {
      continue;
    }
    if (GLOB_CHARS.test(entry)) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, entry),
      );
      uris.push(...found);
    } else {
      uris.push(vscode.Uri.joinPath(folder.uri, entry));
    }
  }
  const unique = new Map(uris.map((uri) => [uri.toString(), uri]));

  return Promise.resolve(
    sortUris(withoutTranslatedSchemas(Array.from(unique.values()))),
  );
};

const schemaUrisInFolder = async (
  folder: string,
  doc: vscode.TextDocument | undefined,
): Promise<vscode.Uri[]> =>
  sortUris(
    (await findSchemaFilesInFolder(folder, doc)).map((filename) =>
      vscode.Uri.file(path.join(folder, filename)),
    ),
  );

/**
 * The schema files a document validates with: those alongside the document,
 * else those in its workspace folder, else the `cedar.schemaFile` setting.
 */
const getSchemaUris = async (
  doc: vscode.TextDocument | undefined = undefined,
): Promise<{ uris: vscode.Uri[]; configured: boolean }> => {
  const autodetect = vscode.workspace
    .getConfiguration('cedar')
    .get<boolean>('autodetectSchemaFile', true);
  if (doc && autodetect && doc.uri.scheme === 'file') {
    const folders = [path.dirname(doc.uri.fsPath)];
    const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (workspace?.uri) {
      folders.push(workspace.uri.fsPath);
    }
    for (const folder of folders) {
      const uris = await schemaUrisInFolder(folder, doc);
      if (uris.length > 0) {
        return Promise.resolve({ uris, configured: false });
      }
    }
  }

  return Promise.resolve({
    uris: await getConfiguredSchemaUris(),
    configured: true,
  });
};

const hashText = (text: string): string =>
  createHash('sha1').update(text).digest('hex').substring(0, 16);

const combineSchemaDocs = async (
  docs: vscode.TextDocument[],
  configured: boolean,
  combinedDoc: boolean = true,
): Promise<CedarSchemaSet> => {
  const result = cedar.linkSchemas(
    docs.map((doc) => doc.getText()),
    docs.map((doc) => (doc.languageId === 'cedarschema' ? 'cedar' : 'json')),
  );
  try {
    const set: CedarSchemaSet = {
      docs: docs,
      configured: configured,
      link: {
        success: result.success,
        mode: result.mode,
        complete: result.complete,
        externalEntityTypes: result.externalEntityTypes,
        externalActions: result.externalActions,
        errors: result.errors,
        warnings: result.warnings,
      },
      doc: undefined,
    };

    if (combinedDoc && result.success && result.schema) {
      // the content is part of the URI, so a cached parse of a combined
      // schema document is never stale
      const folder = configured
        ? vscode.workspace.workspaceFolders?.[0]?.uri.path ||
          path.posix.dirname(docs[0].uri.path)
        : path.posix.dirname(docs[0].uri.path);
      // multiple lines for readability, like a translated schema
      const text = formatJsonText(result.schema);
      const uri = vscode.Uri.from({
        scheme: CEDAR_SCHEMA_SCHEME,
        path: path.posix.join(folder, COMBINED_SCHEMA_FILE),
        query: hashText(text),
      });
      const uris = docs.map((doc) => doc.uri.toString());
      combinedSchemas[uri.toString()] = { text: text, uris: uris };
      pruneCombinedSchemas(uri, uris);
      set.doc = await vscode.workspace.openTextDocument(uri);
    }

    return Promise.resolve(set);
  } finally {
    result.free();
  }
};

type SchemaSetCacheItem = { key: string; set: CedarSchemaSet };
let schemaSetCache: Record<string, SchemaSetCacheItem> = {};
export const clearSchemaSetCache = () => {
  schemaSetCache = {};
};

const openSchemaSet = async (
  uris: vscode.Uri[],
  configured: boolean,
): Promise<CedarSchemaSet | undefined> => {
  const docs: vscode.TextDocument[] = [];
  for (const uri of uris) {
    try {
      docs.push(await vscode.workspace.openTextDocument(uri));
    } catch {
      vscode.window.showErrorMessage(`Missing cedar.schemaFile: ${uri}`);
    }
  }
  if (docs.length === 0) {
    return Promise.resolve(undefined);
  }
  // a single schema file is used as is, unless it is a partial schema with
  // `external` declarations, which are reported by the schema set
  const single = docs.length === 1;
  if (single && !/\bexternal\b/.test(docs[0].getText())) {
    return Promise.resolve({ docs, configured, doc: docs[0] });
  }

  // combine again only when a schema file has changed
  const key = docs.map((doc) => `${doc.uri}#${doc.version}`).join('\n');
  const cachedItem = schemaSetCache[key];
  if (cachedItem) {
    return Promise.resolve(cachedItem.set);
  }
  const set = single
    ? { ...(await combineSchemaDocs(docs, configured, false)), doc: docs[0] }
    : await combineSchemaDocs(docs, configured);
  schemaSetCache[key] = { key, set };

  return Promise.resolve(set);
};

/**
 * The Cedar schema set a document (a Cedar policy, entities, tests, ...)
 * validates with, or undefined when there is no Cedar schema.
 */
export const getSchemaSet = async (
  doc: vscode.TextDocument | undefined = undefined,
): Promise<CedarSchemaSet | undefined> => {
  const { uris, configured } = await getSchemaUris(doc);

  return openSchemaSet(uris, configured);
};

// any file which validates with a schema found in the same folder
const SCHEMA_CONSUMER_KINDS: CedarKind[] = [
  'cedarentities',
  'avpentities',
  'cedartemplatelinks',
  'cedarauth',
  'cedartests',
];

/**
 * The Cedar schema set a schema file belongs to, when its schema files are
 * combined.  A folder of unrelated schema files (with no `external`
 * declarations and nothing alongside them to validate) is not a set, so each
 * of those schema files is still validated on its own.
 */
export const getSchemaSetForSchemaDoc = async (
  schemaDoc: vscode.TextDocument,
): Promise<CedarSchemaSet | undefined> => {
  if (schemaDoc.uri.scheme !== 'file') {
    return Promise.resolve(undefined);
  }
  const contains = (uris: vscode.Uri[]) =>
    uris.length > 1 &&
    uris.some((uri) => uri.toString() === schemaDoc.uri.toString());

  const autodetect = vscode.workspace
    .getConfiguration('cedar')
    .get<boolean>('autodetectSchemaFile', true);
  if (autodetect) {
    const folder = path.dirname(schemaDoc.uri.fsPath);
    const uris = await schemaUrisInFolder(folder, schemaDoc);
    if (contains(uris)) {
      const set = await openSchemaSet(uris, false);
      const workspace = vscode.workspace.getWorkspaceFolder(schemaDoc.uri);
      const consumers = await findFileNamesInFolder(
        folder,
        (filename) =>
          filename.endsWith(CEDAR_EXTENSION) ||
          cedarKindFilenameMatcher(SCHEMA_CONSUMER_KINDS, schemaDoc)(filename),
      );
      if (
        set?.link?.mode === 'link' ||
        consumers.length > 0 ||
        workspace?.uri.fsPath === folder
      ) {
        return Promise.resolve(set);
      }
      return Promise.resolve(undefined);
    }
  }

  const configured = await getConfiguredSchemaUris();
  if (contains(configured)) {
    return openSchemaSet(configured, true);
  }

  return Promise.resolve(undefined);
};

export const getSchemaTextDocument = async (
  doc: vscode.TextDocument | undefined = undefined,
): Promise<vscode.TextDocument | undefined> => {
  const set = await getSchemaSet(doc);

  return Promise.resolve(set?.doc);
};

const relativeSchemaPath = (
  doc: vscode.TextDocument,
  uri: vscode.Uri,
): string => {
  const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
  return workspace?.uri && uri.fsPath.startsWith(workspace.uri.fsPath)
    ? uri.fsPath.substring(workspace.uri.fsPath.length + 1)
    : uri.fsPath;
};

// a schema file alongside the document is named by its filename, otherwise by
// its path, such as the workspace folder fallback or the cedar.schemaFile setting
const schemaFileLabel = (doc: vscode.TextDocument, uri: vscode.Uri): string =>
  path.dirname(uri.fsPath) === path.dirname(doc.uri.fsPath)
    ? path.basename(uri.fsPath)
    : relativeSchemaPath(doc, uri);

/**
 * Describe the schema a document validates with, such as for a CodeLens.
 */
export const describeSchemaSet = (
  doc: vscode.TextDocument,
  set: CedarSchemaSet,
): { title: string; tooltip: string } => {
  // the Problems panel names the `external` declarations without definitions
  const incomplete =
    (set.link?.externalEntityTypes.length || 0) +
      (set.link?.externalActions.length || 0) >
    0
      ? ' (incomplete)'
      : '';
  const names = set.docs
    .map((schemaDoc) => schemaFileLabel(doc, schemaDoc.uri))
    .join(', ');
  if (set.docs.length === 1) {
    return {
      title: `Validated using ${names}${incomplete}`,
      tooltip: `Open ${set.docs[0].uri.fsPath}`,
    };
  }

  const tooltip = set.docs.map((schemaDoc) => schemaDoc.uri.fsPath).join('\n');
  if (!set.doc) {
    return {
      title: `Cedar schema errors in ${names}`,
      tooltip: tooltip,
    };
  }

  return {
    title: `Validated using ${names}${incomplete}`,
    tooltip: tooltip,
  };
};

/**
 * Open the schema a document validates with, choosing one of the schema files
 * or the combined schema for a set of them.
 */
export const openSchemaSetFiles = async (
  doc: vscode.TextDocument,
): Promise<void> => {
  const set = await getSchemaSet(doc);
  if (!set) {
    vscode.window.showErrorMessage(
      `Cedar schema file not found or configured in settings.json`,
    );
    return;
  }

  let uri: vscode.Uri | undefined = set.docs[0].uri;
  if (set.docs.length > 1) {
    const items: (vscode.QuickPickItem & { uri?: vscode.Uri })[] = set.docs.map(
      (schemaDoc) => ({
        label: path.basename(schemaDoc.uri.fsPath),
        description: relativeSchemaPath(doc, schemaDoc.uri),
        uri: schemaDoc.uri,
      }),
    );
    if (set.doc) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
          label: 'Combined schema (JSON)',
          description: set.link?.mode === 'link' ? 'linked' : 'merged',
          uri: set.doc.uri,
        },
      );
    }
    const result = await vscode.window.showQuickPick(items, {
      title: 'Open Cedar schema',
    });
    uri = result?.uri;
  }

  if (uri) {
    try {
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch {
      vscode.window.showErrorMessage(`Cannot open Cedar schema file: ${uri}`);
    }
  }
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
