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
  position: vscode.Position,
  word: string
): Promise<vscode.Hover | undefined> => {
  let mdarray: vscode.MarkdownString[] = [];
  const schemaDoc = await getSchemaTextDocument(document);
  if (schemaDoc) {
    let entities = narrowEntityTypes(schemaDoc, word, document, position);
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
  position: vscode.Position,
  properties: string[],
  range: vscode.Range | undefined
): Promise<vscode.Hover | undefined> => {
  let mdarray: vscode.MarkdownString[] = [];
  const schemaDoc = await getSchemaTextDocument(document);
  if (schemaDoc) {
    let entities = narrowEntityTypes(
      schemaDoc,
      properties[0],
      document,
      position
    );
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
      range: range,
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
    let range = document.getWordRangeAtPosition(position);
    if (range) {
      let word = document.getText(range);
      const { prevChar, nextChar } = getPrevNextCharacters(document, range);
      if (
        prevChar !== '.' &&
        prevChar !== '?' &&
        ['principal', 'resource', 'context', 'action'].includes(word)
      ) {
        return new Promise(async (resolve) => {
          let result = await createVariableHover(document, position, word);
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

      let lineIncludingWord = document.getText(
        new vscode.Range(new vscode.Position(range.start.line, 0), range.end)
      );
      let attemptPropertyChainMatch = false;
      if (prevChar === '.') {
        // principal.propname
        attemptPropertyChainMatch = true;
      } else {
        const line = document.lineAt(position).text;
        const lineBeforeWord = line.substring(0, range.start.character);
        if (lineBeforeWord.endsWith(' has ')) {
          // principal has propname
          attemptPropertyChainMatch = true;
          // normalize `X has propname` to `X["propname"]`
          lineIncludingWord =
            lineBeforeWord.substring(
              0,
              lineBeforeWord.length - 5 // ' has '
            ) + `["${word}"]`;
        } else {
          const prevQuotePos = lineBeforeWord.lastIndexOf('"');
          const nextQuotePos = line.indexOf('"', range.end.character);
          if (prevQuotePos !== -1 && nextQuotePos !== -1) {
            // update hover highlight range to include quoted string
            range = new vscode.Range(
              range.start.with({ character: prevQuotePos + 1 }),
              range.end.with({ character: nextQuotePos })
            );
            word = line.substring(prevQuotePos + 1, nextQuotePos);
            if (line.substring(0, prevQuotePos).endsWith(' has ')) {
              // principal has "propname"
              attemptPropertyChainMatch = true;
              // normalize `X has "propname"` to `X["propname"]`
              lineIncludingWord =
                lineBeforeWord.substring(
                  0,
                  prevQuotePos - 5 // ' has '
                ) + `["${word}"]`;
            } else {
              if (
                line[prevQuotePos - 1] === '[' &&
                line[nextQuotePos + 1] === ']'
              ) {
                // principal["propname"]
                attemptPropertyChainMatch = true;
                lineIncludingWord = line.substring(0, nextQuotePos + 2);
              }
            }
          }
        }
      }

      if (attemptPropertyChainMatch) {
        let found = lineIncludingWord.match(PROPERTY_CHAIN_REGEX);
        if (found && found?.groups) {
          const properties = splitPropertyChain(found[0]);
          return new Promise(async (resolve) => {
            let result = undefined;
            result = await createPropertyHover(
              document,
              position,
              properties,
              range
            );
            resolve(result);
          });
        }
      }
    }
  }
}
