// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { FUNCTION_HELP_DEFINITIONS } from './help';
import { getSchemaTextDocument } from './fileutil';
import { narrowEntityTypes } from './validate';
import { PROPERTY_CHAIN_REGEX } from './regex';
import { parseCedarSchemaDoc, traversePropertyChain } from './parser';
import { splitPropertyChain } from './completion';

const getPrevNextCharacters = (
  document: vscode.TextDocument,
  range: vscode.Range
): { prevChar: string; nextChar: string } => {
  let prevChar = '',
    nextChar = '';
  const nextCharPos = new vscode.Position(
    range.end.line,
    range.end.character + 1
  );
  if (document.validatePosition(nextCharPos)) {
    nextChar = document.getText(new vscode.Range(range.end, nextCharPos));
  }
  const prevCharPos = new vscode.Position(
    range.start.line,
    range.start.character - 1
  );
  if (document.validatePosition(prevCharPos)) {
    prevChar = document.getText(new vscode.Range(prevCharPos, range.start));
  }

  return { prevChar: prevChar, nextChar: nextChar };
};

const createVariableHover = async (
  document: vscode.TextDocument,
  word: string
): Promise<vscode.Hover | undefined> => {
  let mdarray: vscode.MarkdownString[] = [];
  const schemaDoc = await getSchemaTextDocument(undefined, document);
  if (schemaDoc) {
    let entities = narrowEntityTypes(schemaDoc, word);
    entities.forEach((entityType) => {
      const md = new vscode.MarkdownString();
      md.appendCodeblock(entityType, 'cedar');
      mdarray.push(md);
    });
  }

  if (mdarray.length > 0) {
    return {
      contents: mdarray,
    };
  }
  return undefined;
};

const createPropertyHover = async (
  document: vscode.TextDocument,
  properties: string[]
): Promise<vscode.Hover | undefined> => {
  let mdarray: vscode.MarkdownString[] = [];
  const schemaDoc = await getSchemaTextDocument(undefined, document);
  if (schemaDoc) {
    let entities = narrowEntityTypes(schemaDoc, properties[0]);
    const completions = parseCedarSchemaDoc(schemaDoc).completions;
    let word = properties[properties.length - 1];
    entities.forEach((entityType) => {
      const { lastType } = traversePropertyChain(
        completions,
        properties,
        entityType
      );
      if (lastType) {
        let md = new vscode.MarkdownString();
        md.appendCodeblock(`(${entityType}) ${word}: ${lastType}`, 'cedar');
        mdarray.push(md);
      }
    });
  }

  if (mdarray.length > 0) {
    return {
      contents: mdarray,
    };
  }
  return undefined;
};

export class CedarHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position);
    if (range) {
      const word = document.getText(range);

      const { prevChar, nextChar } = getPrevNextCharacters(document, range);
      if (
        prevChar !== '.' &&
        prevChar !== '?' &&
        ['principal', 'resource', 'context', 'action'].includes(word)
      ) {
        return new Promise(async (resolve) => {
          let result = await createVariableHover(document, word);
          resolve(result);
        });
      }

      if (nextChar === '(') {
        if (FUNCTION_HELP_DEFINITIONS[word]) {
          return {
            contents: FUNCTION_HELP_DEFINITIONS[word],
          };
        }
      }

      const line = document.lineAt(position).text;
      const lineBeforeWord = line.substring(0, range.start.character);

      // TODO: match quoted properties (e.g. principal["propname with space"])
      if (prevChar === '.' || lineBeforeWord.endsWith(' has ')) {
        const lineIncludingWord = document.getText(
          new vscode.Range(new vscode.Position(range.start.line, 0), range.end)
        );
        let found = lineIncludingWord
          .replaceAll(' has ', '.')
          .match(PROPERTY_CHAIN_REGEX);
        if (found && found?.groups) {
          const properties = splitPropertyChain(found[0]);
          return new Promise(async (resolve) => {
            let result = undefined;
            result = await createPropertyHover(document, properties);
            resolve(result);
          });
        }
      }
    }
  }
}
