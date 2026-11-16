// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import { FUNCTION_HELP_DEFINITIONS } from './help';
import { getSchemaTextDocument } from './fileutil';
import { narrowEntityTypes } from './validate';
import { PROPERTY_CHAIN_REGEX } from './regex';
import { parseCedarSchemaDoc, traversePropertyChain } from './parser';
import { splitPropertyChain } from './completion';
import {
  cedarReferences,
  findDefinition,
  findReferencedDefinition,
  findSchemaNameAtPosition,
  PolicyFinder,
  SchemaDefinition,
  SchemaReferences,
} from './definition';

const getPrevNextCharacters = (
  document: vscode.TextDocument,
  range: vscode.Range,
): { prevChar: string; nextChar: string } => {
  let prevChar = '',
    nextChar = '';
  const nextCharPos = new vscode.Position(
    range.end.line,
    range.end.character + 1,
  );
  if (document.validatePosition(nextCharPos)) {
    nextChar = document.getText(new vscode.Range(range.end, nextCharPos));
  }
  const prevCharPos = new vscode.Position(
    range.start.line,
    range.start.character - 1,
  );
  if (document.validatePosition(prevCharPos)) {
    prevChar = document.getText(new vscode.Range(prevCharPos, range.start));
  }

  return { prevChar: prevChar, nextChar: nextChar };
};

const createVariableHover = async (
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string,
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
  range: vscode.Range | undefined,
): Promise<vscode.Hover | undefined> => {
  let mdarray: vscode.MarkdownString[] = [];
  const schemaDoc = await getSchemaTextDocument(document);
  if (schemaDoc) {
    let entities = narrowEntityTypes(
      schemaDoc,
      properties[0],
      document,
      position,
    );
    const completions = parseCedarSchemaDoc(schemaDoc).completions;
    let word = properties[properties.length - 1];
    entities.forEach((entityType) => {
      const { lastType } = traversePropertyChain(
        completions,
        properties,
        entityType,
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

/**
 * Hover over an entity type or action in a Cedar policy file, showing its
 * definition and the schema file it is in, otherwise hover help for variables,
 * functions, and properties.
 */
export class CedarHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null | undefined> {
    const found = await findReferencedDefinition(
      document,
      position,
      cedarReferences,
    );
    if (found?.definition) {
      return definitionHover(found.definition, found.referenced.range);
    }
    return this.provideHelpHover(document, position);
  }

  private provideHelpHover(
    document: vscode.TextDocument,
    position: vscode.Position,
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
        new vscode.Range(new vscode.Position(range.start.line, 0), range.end),
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
              lineBeforeWord.length - 5, // ' has '
            ) + `["${word}"]`;
        } else {
          const prevQuotePos = lineBeforeWord.lastIndexOf('"');
          const nextQuotePos = line.indexOf('"', range.end.character);
          if (prevQuotePos !== -1 && nextQuotePos !== -1) {
            // update hover highlight range to include quoted string
            range = new vscode.Range(
              range.start.with({ character: prevQuotePos + 1 }),
              range.end.with({ character: nextQuotePos }),
            );
            word = line.substring(prevQuotePos + 1, nextQuotePos);
            if (line.substring(0, prevQuotePos).endsWith(' has ')) {
              // principal has "propname"
              attemptPropertyChainMatch = true;
              // normalize `X has "propname"` to `X["propname"]`
              lineIncludingWord =
                lineBeforeWord.substring(
                  0,
                  prevQuotePos - 5, // ' has '
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
              range,
            );
            resolve(result);
          });
        }
      }
    }
  }
}

export class CedarEntitiesJSONHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    let range = document.getWordRangeAtPosition(position);
    if (range) {
      let word = document.getText(range);
      const { prevChar, nextChar } = getPrevNextCharacters(document, range);
      if (
        prevChar === '"' &&
        nextChar === '"' &&
        ['ip', 'decimal', 'datetime', 'duration'].includes(word)
      ) {
        const line = document.lineAt(position).text;
        const lineBeforeWord = line.substring(0, range.start.character - 1);
        if (
          lineBeforeWord.trim().endsWith('"fn":') &&
          FUNCTION_HELP_DEFINITIONS[word]
        ) {
          return {
            contents: FUNCTION_HELP_DEFINITIONS[word],
          };
        }
      }
    }
  }
}

// the declaration text, without the indentation it shares with its first line
const declarationText = (
  doc: vscode.TextDocument,
  range: vscode.Range,
): string => {
  const MAX_LINES = 20;
  const lines = doc.getText(range).trimEnd().split(/\r?\n/);
  const indent = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.length - line.trimStart().length),
  );
  const text = lines
    .slice(0, MAX_LINES)
    .map((line) => line.substring(indent))
    .join('\n');
  return lines.length > MAX_LINES ? `${text}\n…` : text;
};

// the declaration and a link to the file it is in
const declarationHover = (
  doc: vscode.TextDocument,
  declarationRange: vscode.Range,
  language: string,
  range: vscode.Range,
): vscode.Hover => {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(declarationText(doc, declarationRange), language);
  const uri = doc.uri.with({
    fragment: `L${declarationRange.start.line + 1}`,
  });
  md.appendMarkdown(`Defined in [${path.basename(doc.uri.fsPath)}](${uri})`);
  return { contents: [md], range: range };
};

// the schema declaration and a link to the schema file it is in
const definitionHover = (
  definition: SchemaDefinition,
  range: vscode.Range,
): vscode.Hover =>
  declarationHover(
    definition.doc,
    definition.schemaRange.range,
    definition.doc.languageId === 'cedarschema' ? 'cedarschema' : 'json',
    range,
  );

/**
 * Hover over an entity type or action in a Cedar JSON file (entities, template
 * links, auth, tests, or JSON policies), showing its schema definition and the
 * schema file it is in.
 */
export class CedarDefinitionHoverProvider implements vscode.HoverProvider {
  constructor(private readonly references: SchemaReferences) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const found = await findReferencedDefinition(
      document,
      position,
      this.references,
    );
    return found?.definition
      ? definitionHover(found.definition, found.referenced.range)
      : undefined;
  }
}

/**
 * Hover over a policy id which links to a policy (a template links
 * template_id, a tests "reason", or a JSON policy set templateId), showing the
 * policy and the file it is in, otherwise the schema definition of an entity
 * type or action.
 */
export class CedarPolicyHoverProvider extends CedarDefinitionHoverProvider {
  constructor(
    private readonly findPolicy: PolicyFinder,
    references: SchemaReferences,
  ) {
    super(references);
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const found = await this.findPolicy(document, position);
    if (found) {
      return found.definition
        ? declarationHover(
            found.definition.doc,
            found.definition.range,
            found.definition.doc.languageId === 'cedar' ? 'cedar' : 'json',
            found.referenced.range,
          )
        : undefined;
    }
    return super.provideHover(document, position, token);
  }
}

/**
 * Hover over an entity type, common type, or action in a schema file which is
 * declared `external` or defined by another schema file of its schema set,
 * showing the definition and the schema file it is in.
 */
export class CedarSchemaHoverProvider implements vscode.HoverProvider {
  async provideHover(
    schemaDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const found = await findSchemaNameAtPosition(schemaDoc, position);
    if (!found) {
      return undefined;
    }

    const definition = findDefinition(found.docs, found.name, true);
    if (definition && definition.doc !== schemaDoc) {
      return definitionHover(definition, found.range);
    } else if (!definition && found.external) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(
        `\`${found.name}\` is declared \`external\` but not defined by any linked schema`,
      );
      return { contents: [md], range: found.range };
    }

    // defined in this schema file
    return undefined;
  }
}
