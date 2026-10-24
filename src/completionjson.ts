// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import {
  SchemaCacheItem,
  SchemaCompletionRecord,
  parseCedarSchemaDoc,
} from './parser';
import { DECISIONS, determineEntityTypes, validateSchemaDoc } from './validate';
import { getSchemaTextDocument } from './fileutil';
import { createDiagnosticCollection } from './diagnostics';

const isTopLevelJSON = (
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let line = 0; line <= position.line; line++) {
    const text = document.lineAt(line).text;
    const endChar = line === position.line ? position.character : text.length;

    for (let i = 0; i < endChar; i++) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
        }
      }
    }
  }

  return depth === 1; // Inside top-level object
};

const EXTENSIONS: Record<string, { fn: string; arg: string }> = {
  ipaddr: { fn: 'ip', arg: '127.0.0.1' },
  decimal: { fn: 'decimal', arg: '12345.6789' },
  datetime: { fn: 'datetime', arg: '2024-10-15T11:35:00Z' },
  duration: { fn: 'duration', arg: '1d2h3m4s5ms' },
};

// the escapes of a JSON string, without the surrounding quotes
const jsonEscape = (value: string): string =>
  JSON.stringify(value).slice(1, -1);

// `\`, `$`, and `}` have their own meaning in the snippet syntax, so a value
// already escaped for JSON is escaped again to survive snippet insertion
const snippetEscape = (value: string): string =>
  value.replace(/[\\$}]/g, '\\$&');

export const snippetify = (
  schema: SchemaCacheItem,
  attributes: SchemaCompletionRecord,
  tabstop: number,
  stack: string[], // recursive loop safety
  indent: number = 1,
): { value: string; tabstop: number } => {
  const completions = schema.completions;
  const prefix = '\n' + ' '.repeat(indent * 2);
  let s = '';
  Object.keys(attributes).forEach((key) => {
    const type = attributes[key].description;
    let value: string | number | boolean | object = '""';
    if (type === 'Bool' || type === 'Boolean') {
      value = `$\{${tabstop++}|false,true|}`;
    } else if (type === 'String') {
      value = `"$${tabstop++}"`;
    } else if (type === 'Long') {
      value = `$\{${tabstop++}:0}`;
    } else if (type === 'Set' || type.startsWith('Set<')) {
      value = `[$${tabstop++}]`;
    } else if (EXTENSIONS[type]) {
      value = `{ "fn": "${EXTENSIONS[type].fn}", "arg": "$\{${tabstop++}:${
        EXTENSIONS[type].arg
      }}" }`;
    } else if (attributes[key].children) {
      ({ value, tabstop } = snippetify(
        schema,
        attributes[key].children as SchemaCompletionRecord,
        tabstop++,
        stack,
        indent + 1,
      ));
    } else if (schema.entityTypes.includes(type)) {
      value = `{ "type": "${type}", "id": "$${tabstop++}" }`;
    } else if (
      completions[type] &&
      Object.keys(completions[type]).length > 0 &&
      !stack.includes(type)
    ) {
      ({ value, tabstop } = snippetify(
        schema,
        completions[type],
        tabstop++,
        [...stack, type],
        indent + 1,
      ));
    } else {
      value = ``; // should not get here
    }
    s += `${prefix}"${snippetEscape(jsonEscape(key))}": ${value},`;
  });

  return {
    value:
      '{' +
      s.substring(0, s.length - 1) +
      '\n' +
      ' '.repeat((indent - 1) * 2) +
      '}',
    tabstop: tabstop,
  };
};

export class CedarEntitiesJSONCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const items: vscode.CompletionItem[] = [];
    if (isTopLevelJSON(document, position)) {
      const schemaDoc = await getSchemaTextDocument(document);
      if (schemaDoc) {
        if (validateSchemaDoc(schemaDoc, createDiagnosticCollection())) {
          const schema = parseCedarSchemaDoc(schemaDoc);
          const entityTypes = schema.entityTypes;

          entityTypes.forEach((entityType) => {
            const tmpEntity = entityBodySnippet(schema, entityType);
            let item = new vscode.CompletionItem(
              {
                label: entityType,
                description: `"uid": { "type": "${entityType}", ...`,
              },
              vscode.CompletionItemKind.Struct,
            );
            item.range = new vscode.Range(position, position);

            item.insertText = new vscode.SnippetString(tmpEntity);
            items.push(item);
          });
        }
      }
    }
    return items;
  }
}

/**
 * Build the snippet body of a Cedar entity.  The enclosing braces are supplied
 * by the caller (or already typed by the user), and the leading indentation is
 * relative, so Visual Studio Code re-indents it to the insert position.
 */
export const entityBodySnippet = (
  schema: SchemaCacheItem,
  entityType: string,
): string => {
  let attrs = '';
  let tabstop = 2;
  ({ value: attrs, tabstop } = snippetify(
    schema,
    schema.completions[entityType],
    tabstop,
    [entityType],
    2,
  ));

  return `
  "uid": { "type": "${entityType}", "id": "$1" },
  "attrs": ${attrs},
  "parents": [$${tabstop}]
`;
};

// `\"` inside a JSON string, for example "PhotoApp::User::\"alice\""
const Q = '\\"';

/**
 * A Cedar action id is `Namespace::Action::"id"`, where the id is a Cedar
 * string using the same escapes as a JSON string.  Used when embedding an
 * action id in Cedar policy text.
 */
const cedarActionId = (actionId: string): string => {
  const start = actionId.indexOf('::"');
  const end = actionId.lastIndexOf('"');
  if (start === -1 || end < start + 3) {
    return actionId;
  }

  const id = actionId.substring(start + 3, end);

  return `${actionId.substring(0, start + 2)}"${jsonEscape(id)}"`;
};

// a snippet choice, or a plain tab stop when the schema offers nothing to pick
const choice = (tabstop: number, values: string[]): string =>
  values.length > 0 ? `\${${tabstop}|${values.join(',')}|}` : `$${tabstop}`;

export const schemaActionIds = (schemaDoc: vscode.TextDocument): string[] =>
  parseCedarSchemaDoc(schemaDoc)
    .definitionRanges.filter(
      (definition) => definition.collection === 'actions',
    )
    .map((definition) => definition.etype);

/**
 * Build the snippet body of a Cedar test for an action.  The principal and
 * resource types are narrowed to those the action applies to, and the context
 * is scaffolded from the attributes the schema declares for that action.
 */
export const testBodySnippet = (
  schema: SchemaCacheItem,
  schemaDoc: vscode.TextDocument,
  actionId: string,
): string => {
  const head = `permit (principal, action == ${cedarActionId(actionId)}, resource)`;
  const principals = determineEntityTypes(schemaDoc, 'principal', head);
  const resources = determineEntityTypes(schemaDoc, 'resource', head);

  // context attributes are declared per action in the Cedar schema
  let tabstop = 6;
  let contextAttrs: string;
  const attributes = schema.completions[actionId];
  if (attributes && Object.keys(attributes).length > 0) {
    ({ value: contextAttrs, tabstop } = snippetify(
      schema,
      attributes,
      tabstop,
      [actionId],
      3,
    ));
  } else {
    contextAttrs = `{$${tabstop++}}`;
  }

  return `
  "name": "$1",
  "request": {
    "principal": "${choice(2, principals)}::${Q}$3${Q}",
    "action": "${snippetEscape(jsonEscape(actionId))}",
    "resource": "${choice(4, resources)}::${Q}$5${Q}",
    "context": ${contextAttrs}
  },
  "decision": "${choice(tabstop++, DECISIONS)}",
  "reason": [$${tabstop++}],
  "num_errors": \${${tabstop++}:0}
`;
};

const braced = (body: string, braces: boolean): string =>
  braces ? `{${body}}` : body;

export class CedarTestsJSONCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const items: vscode.CompletionItem[] = [];
    const jsonPath = jsonc.getLocation(
      document.getText(),
      document.offsetAt(position),
    ).path;

    // inside the array of tests, either before or after typing the `{`
    const newTestBraces =
      jsonPath.length === 1 && typeof jsonPath[0] === 'number';
    const newTest =
      newTestBraces || (jsonPath.length === 2 && jsonPath[1] === '');

    // inside the "entities" array of a test, before or after typing the `{`
    const newEntityBraces =
      jsonPath.length === 3 &&
      jsonPath[1] === 'entities' &&
      typeof jsonPath[2] === 'number';
    const newEntity =
      newEntityBraces ||
      (jsonPath.length === 4 &&
        jsonPath[1] === 'entities' &&
        jsonPath[3] === '');

    if (!newTest && !newEntity) {
      return items;
    }

    const schemaDoc = await getSchemaTextDocument(document);
    if (
      !schemaDoc ||
      !validateSchemaDoc(schemaDoc, createDiagnosticCollection())
    ) {
      return items;
    }
    const schema = parseCedarSchemaDoc(schemaDoc);

    if (newTest) {
      schemaActionIds(schemaDoc).forEach((actionId) => {
        const item = new vscode.CompletionItem(
          {
            label: actionId,
            description: `"request": { "action": "${actionId}", ...`,
          },
          vscode.CompletionItemKind.Event,
        );
        item.range = new vscode.Range(position, position);
        item.insertText = new vscode.SnippetString(
          braced(testBodySnippet(schema, schemaDoc, actionId), newTestBraces),
        );
        items.push(item);
      });
    } else {
      schema.entityTypes.forEach((entityType) => {
        const item = new vscode.CompletionItem(
          {
            label: entityType,
            description: `"uid": { "type": "${entityType}", ...`,
          },
          vscode.CompletionItemKind.Struct,
        );
        item.range = new vscode.Range(position, position);
        item.insertText = new vscode.SnippetString(
          braced(entityBodySnippet(schema, entityType), newEntityBraces),
        );
        items.push(item);
      });
    }

    return items;
  }
}

/**
 * Find where to insert a new object in a JSON document containing a top level
 * array, and whether a leading comma is needed.
 */
const findInsertPosition = (
  document: vscode.TextDocument,
  cursorPosition: vscode.Position,
): { position: vscode.Position; objects: number } => {
  let position: vscode.Position | null = null;
  const currentLine = cursorPosition.line;
  let objects = 0;
  let depth = 0;
  jsonc.visit(document.getText(), {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      if (depth === 0) {
        objects++;
      }
      depth++;
    },
    onObjectEnd(offset, length, startLine, startCharacter) {
      depth--;
      if (depth === 0 && position === null && startLine > currentLine) {
        position = new vscode.Position(startLine, startCharacter + 1);
      }
    },
  });

  return {
    position: position || new vscode.Position(0, 1),
    objects: objects,
  };
};

export const addTestsJSON = async (
  textEditor: vscode.TextEditor,
  diagnosticCollection: vscode.DiagnosticCollection,
): Promise<boolean> => {
  const { position, objects } = findInsertPosition(
    textEditor.document,
    textEditor.selection.active,
  );

  let body = '\n  "name": "$1"\n';
  const schemaDoc = await getSchemaTextDocument(textEditor.document);
  if (schemaDoc && validateSchemaDoc(schemaDoc, diagnosticCollection)) {
    const schema = parseCedarSchemaDoc(schemaDoc);
    const items: vscode.QuickPickItem[] = schemaActionIds(schemaDoc).map(
      (actionId) => ({ label: actionId }),
    );
    if (items.length > 0) {
      const result = await vscode.window.showQuickPick(items, {
        title: 'Add Cedar test',
      });
      if (!result) {
        return Promise.resolve(false);
      }
      body = testBodySnippet(schema, schemaDoc, result.label);
    }
  }

  const snippet = (objects > 0 ? ',\n' : '\n') + braced(body, true);
  await textEditor.insertSnippet(new vscode.SnippetString(snippet), position);

  return Promise.resolve(true);
};

export const addEntitiesJSON = async (
  textEditor: vscode.TextEditor,
  diagnosticCollection: vscode.DiagnosticCollection,
): Promise<boolean> => {
  const { position, objects: entities } = findInsertPosition(
    textEditor.document,
    textEditor.selection.active,
  );

  let entityType = '';
  // const attrs: Record<string, string | number | boolean | object> = {};
  let attrs = '';
  let tabstop = 2;
  const schemaDoc = await getSchemaTextDocument(textEditor.document);
  if (schemaDoc) {
    if (validateSchemaDoc(schemaDoc, diagnosticCollection)) {
      const schema = parseCedarSchemaDoc(schemaDoc);
      const entityTypes = schema.entityTypes;
      const items: vscode.QuickPickItem[] = entityTypes.map((etype) => ({
        label: etype,
      }));
      if (items.length > 0) {
        const result = await vscode.window.showQuickPick(items, {
          title: 'Add Cedar entity',
        });
        if (result) {
          entityType = result.label;

          const completions = schema.completions;
          ({ value: attrs, tabstop } = snippetify(
            schema,
            completions[entityType],
            tabstop,
            [entityType],
            2,
          ));
        }
      }
    }
  }

  const tmpEntity = `{
  "uid": { "type": "${entityType}", "id": "$1" },
  "attrs": ${attrs},
  "parents": [$${tabstop}]
}`;

  const snippet = (entities > 0 ? ',\n' : '\n') + tmpEntity;
  const entity = new vscode.SnippetString(snippet);
  await textEditor.insertSnippet(entity, position);

  return Promise.resolve(true);
};
