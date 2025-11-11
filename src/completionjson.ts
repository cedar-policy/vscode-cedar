// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import {
  SchemaCacheItem,
  SchemaCompletionRecord,
  parseCedarSchemaDoc,
} from './parser';
import { validateSchemaDoc } from './validate';
import { getSchemaTextDocument } from './fileutil';
import { createDiagnosticCollection } from './diagnostics';

const isTopLevelJSON = (
  document: vscode.TextDocument,
  position: vscode.Position
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

export const snippetify = (
  schema: SchemaCacheItem,
  attributes: SchemaCompletionRecord,
  tabstop: number,
  stack: string[], // recursive loop safety
  indent: number = 1
): { value: string; tabstop: number } => {
  const completions = schema.completions;
  const prefix = '\n' + ' '.repeat(indent * 2);
  let s = '';
  Object.keys(attributes).forEach((key) => {
    const type = attributes[key].description;
    let value: string | number | boolean | object = '""';
    if (type === 'Bool') {
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
        indent + 1
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
        indent + 1
      ));
    } else {
      value = ``; // should not get here
    }
    s += `${prefix}"${key}": ${value},`;
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
    context: vscode.CompletionContext
  ) {
    const items: vscode.CompletionItem[] = [];
    if (isTopLevelJSON(document, position)) {
      const schemaDoc = await getSchemaTextDocument(document);
      if (schemaDoc) {
        if (validateSchemaDoc(schemaDoc, createDiagnosticCollection())) {
          const schema = parseCedarSchemaDoc(schemaDoc);
          const entityTypes = schema.entityTypes;

          entityTypes.forEach((entityType) => {
            let attrs = '';
            let tabstop = 2;
            const completions = schema.completions;
            ({ value: attrs, tabstop } = snippetify(
              schema,
              completions[entityType],
              2,
              [entityType],
              2
            ));

            const tmpEntity = `
  "uid": { "type": "${entityType}", "id": "$1" },
  "attrs": ${attrs},
  "parents": [$${tabstop}]
`;
            let item = new vscode.CompletionItem(
              {
                label: entityType,
                description: `"uid": { "type": "${entityType}", ...`,
              },
              vscode.CompletionItemKind.Struct
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

export const addEntitiesJSON = async (
  textEditor: vscode.TextEditor,
  diagnosticCollection: vscode.DiagnosticCollection
): Promise<boolean> => {
  let position: vscode.Position | null = null;
  const cursorPosition = textEditor.selection.active;
  const currentLine = cursorPosition.line;
  let entities = 0;
  let depth = 0;
  jsonc.visit(textEditor.document.getText(), {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      if (depth === 0) {
        entities++;
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
            2
          ));
        }
      }
    }
  }

  if (position === null) {
    position = new vscode.Position(0, 1);
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
