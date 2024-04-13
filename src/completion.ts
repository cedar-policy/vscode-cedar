// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { FUNCTION_HELP_DEFINITIONS } from './help';
import {
  PRIMITIVE_TYPES,
  SchemaCompletionRecord,
  parseCedarPoliciesDoc,
  parseCedarSchemaDoc,
  traversePropertyChain,
} from './parser';
import { getSchemaTextDocument } from './fileutil';
import { narrowEntityTypes } from './validate';
import { IDENT_REGEX, PROPERTY_CHAIN_REGEX } from './regex';

// helper method for set, IPAddr, and Decimal functions
const createFunctionItem = (
  range: vscode.Range,
  label: string,
  snippetString?: string
): vscode.CompletionItem => {
  // use first line of Hover Help as detail for completion item
  const help = FUNCTION_HELP_DEFINITIONS[label];

  let item = new vscode.CompletionItem(
    help && help.length > 1
      ? { label: label, detail: help[0].substring(label.length) }
      : label,
    vscode.CompletionItemKind.Function
  );
  item.range = range;
  if (snippetString) {
    item.insertText = new vscode.SnippetString(snippetString);
  }

  return item;
};

// Set functions
const createContainsItems = (
  position: vscode.Position
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = new vscode.Range(position, position);

  items.push(createFunctionItem(range, 'contains', 'contains($1) $0'));
  items.push(createFunctionItem(range, 'containsAll', 'containsAll([$1]) $0'));
  items.push(createFunctionItem(range, 'containsAny', 'containsAny([$1]) $0'));

  return items;
};

// [^\s"]* inside the (" ") avoids a greedy match
const IP_REGEX = /\bip\("[^\s"]*"\)\.$/;
const DECIMAL_REGEX = /\bdecimal\("[^\s"]*"\)\.$/;

// IPAddr extension functions
const createIpFunctionItem = (range: vscode.Range): vscode.CompletionItem => {
  return createFunctionItem(range, 'ip', 'ip("${1:127.0.0.1}")$0');
};
const createIPAddrItems = (
  position: vscode.Position
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = new vscode.Range(position, position);

  items.push(createFunctionItem(range, 'isIpv4', 'isIpv4() $0'));
  items.push(createFunctionItem(range, 'isIpv6', 'isIpv6() $0'));
  items.push(createFunctionItem(range, 'isLoopback', 'isLoopback() $0'));
  items.push(createFunctionItem(range, 'isMulticast', 'isMulticast() $0'));
  items.push(createFunctionItem(range, 'isInRange', 'isInRange($1) $0'));

  return items;
};

// Decimal extension functions
const createDecimalFunctionItem = (
  range: vscode.Range
): vscode.CompletionItem => {
  return createFunctionItem(range, 'decimal', 'decimal("${1:0.1234}")$0');
};
const createDecimalItems = (
  position: vscode.Position
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = new vscode.Range(position, position);

  items.push(createFunctionItem(range, 'lessThan', 'lessThan($1) $0'));
  items.push(
    createFunctionItem(range, 'lessThanOrEqual', 'lessThanOrEqual($1) $0')
  );
  items.push(createFunctionItem(range, 'greaterThan', 'greaterThan($1) $0'));
  items.push(
    createFunctionItem(range, 'greaterThanOrEqual', 'greaterThanOrEqual($1) $0')
  );

  return items;
};

const ENTITY_REGEX = /(?:\s|=|\[|\()(?<entity>(?:[_a-zA-Z][_a-zA-Z0-9]*::)+)$/;
const SCOPE_REGEX =
  /(?<element>(principal|action|resource))(\s*==\s*|(\s+is\s+([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*)?\s+in\s+\[?)(?<trigger>.?)$/;
const IS_REGEX =
  /\b(?<!\.)(?<element>(([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*::"(?<id>([^"]*))"|principal|resource))\s+is\s+(?<trigger>.?)$/;

export const splitPropertyChain = (property: string) => {
  const parts: string[] = [];
  let start = 0;
  let insideQuotes = false;
  for (let pos = start; pos < property.length; pos++) {
    const char = property[pos];
    if (insideQuotes) {
      if (char === '"') {
        // doesn't handled embedded " e.g "5' 10\"" and don't care
        parts.push(property.substring(start, pos));
        pos += 1;
        start = pos + 1;
        insideQuotes = false;
      }
    } else if (char === '.') {
      if (start !== pos) {
        parts.push(property.substring(start, pos));
      }
      start = pos + 1;
    } else if (char === '[') {
      if (start !== pos) {
        parts.push(property.substring(start, pos));
      }
      pos += 2;
      insideQuotes = true;
      start = pos;
    } else if (pos === property.length - 1) {
      parts.push(property.substring(start));
    }
  }

  return parts;
};

const createEntityItems = (
  position: vscode.Position,
  schemaDoc: vscode.TextDocument,
  element: string,
  trigger: string,
  typeOnly: boolean = false
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = trigger
    ? new vscode.Range(
        new vscode.Position(position.line, position.character - trigger.length),
        position
      )
    : new vscode.Range(position, position);

  const definitionRanges = parseCedarSchemaDoc(schemaDoc).definitionRanges;

  definitionRanges.forEach((definition) => {
    if (element === 'action') {
      if (definition.collection === 'actions') {
        let item = new vscode.CompletionItem(
          definition.etype,
          vscode.CompletionItemKind.Value
        );
        item.range = range;
        items.push(item);
      }
    } else if (definition.collection === 'entityTypes') {
      let item = new vscode.CompletionItem(
        definition.etype,
        vscode.CompletionItemKind.Class
      );
      if (!typeOnly) {
        item.insertText = new vscode.SnippetString(definition.etype + '::"$1"');
      }
      item.range = range;
      items.push(item);
    }
  });

  return items;
};

const createAttributeItems = (
  position: vscode.Position,
  entityType: string,
  attributes: SchemaCompletionRecord
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = new vscode.Range(position, position);

  Object.keys(attributes).forEach((key) => {
    let item = new vscode.CompletionItem(
      {
        label: key,
        detail: `: ${attributes[key].description}`,
        description: entityType,
      },
      vscode.CompletionItemKind.Field
    );
    item.range = range;
    let match = key.match(IDENT_REGEX);
    if (match === null) {
      // properties not matching IDENT need a different notation
      item.insertText = new vscode.SnippetString(`["${key}"]`);
      // and remove the preceding . that triggered the completion
      item.additionalTextEdits = [
        vscode.TextEdit.delete(
          new vscode.Range(
            new vscode.Position(position.line, position.character - 1),
            position
          )
        ),
      ];
    }
    items.push(item);
  });

  return items;
};

const createEntityTypesAttributeItems = (
  position: vscode.Position,
  schemaDoc: vscode.TextDocument,
  entityTypes: string[]
): vscode.CompletionItem[] => {
  let items: vscode.CompletionItem[] = [];
  const completions = parseCedarSchemaDoc(schemaDoc).completions;
  entityTypes.forEach((entityType) => {
    const attributes = completions[entityType];
    items = items.concat(
      createAttributeItems(position, entityType, attributes)
    );
  });

  return items;
};

const createVariableItem = (
  range: vscode.Range,
  label: string
): vscode.CompletionItem => {
  const item = new vscode.CompletionItem(
    label,
    vscode.CompletionItemKind.Variable
  );
  item.range = range;
  return item;
};

const createInvokeItems = (
  position: vscode.Position
): vscode.CompletionItem[] => {
  const items: vscode.CompletionItem[] = [];
  const range = new vscode.Range(position, position);
  let item;

  ['principal', 'action', 'resource', 'context'].forEach((element) => {
    item = createVariableItem(range, element);
    items.push(item);
  });

  items.push(createIpFunctionItem(range));
  items.push(createDecimalFunctionItem(range));

  return items;
};

const provideCedarPeriodTriggerItems = async (
  position: vscode.Position,
  linePrefix: string,
  document: vscode.TextDocument
): Promise<vscode.CompletionItem[] | undefined> => {
  if (linePrefix.endsWith(').')) {
    if (linePrefix.match(IP_REGEX)) {
      return createIPAddrItems(position);
    } else if (linePrefix.match(DECIMAL_REGEX)) {
      return createDecimalItems(position);
    }
  }

  let found = linePrefix.match(PROPERTY_CHAIN_REGEX);
  if (found?.groups) {
    const properties = splitPropertyChain(found[0]);
    const schemaDoc = await getSchemaTextDocument(undefined, document);
    if (schemaDoc) {
      let entities = narrowEntityTypes(
        schemaDoc,
        properties[0],
        document,
        position
      );

      if (properties.length === 1) {
        return createEntityTypesAttributeItems(position, schemaDoc, entities);
      } else {
        let items: vscode.CompletionItem[] = [];
        const completions = parseCedarSchemaDoc(schemaDoc).completions;
        const lastTypes = new Set<string>();
        entities.forEach((entityType) => {
          const { lastType, completion } = traversePropertyChain(
            completions,
            properties,
            entityType
          );

          if (lastType) {
            if (lastType === 'Record' && completion) {
              items = items.concat(
                createAttributeItems(position, entityType, completion)
              );
            } else if (!lastTypes.has(lastType)) {
              lastTypes.add(lastType);
              if (lastType.startsWith('Set<')) {
                items = items.concat(createContainsItems(position));
              } else if (lastType === 'ipaddr') {
                items = items.concat(createIPAddrItems(position));
              } else if (lastType === 'decimal') {
                items = items.concat(createDecimalItems(position));
              } else if (!PRIMITIVE_TYPES.includes(lastType)) {
                items = items.concat(
                  createEntityTypesAttributeItems(position, schemaDoc, [
                    lastType,
                  ])
                );
              }
            }
          }
        });
        return items;
      }
    }
  }

  if (linePrefix.endsWith('].')) {
    return createContainsItems(position);
  }

  return undefined;
};

const provideCedarTriggerCharacterCompletionItems = async (
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  context: vscode.CompletionContext
) => {
  const linePrefix = document
    .lineAt(position)
    .text.substring(0, position.character);

  if (context.triggerCharacter === '.') {
    return provideCedarPeriodTriggerItems(position, linePrefix, document);
  } else if (context.triggerCharacter === ':') {
    if (linePrefix.endsWith('::')) {
      let found = linePrefix.match(ENTITY_REGEX);
      if (found?.groups) {
        const entity = found?.groups.entity;
        const schemaDoc = await getSchemaTextDocument(undefined, document);
        if (schemaDoc) {
          return createEntityItems(position, schemaDoc, '', entity);
        }
      }
    }
  } else if (context.triggerCharacter === '@') {
    if (linePrefix === '// @') {
      let item = new vscode.CompletionItem(
        '@formatter:off',
        vscode.CompletionItemKind.Property
      );
      item.insertText = new vscode.SnippetString('formatter:off$0');
      item.range = new vscode.Range(position, position);
      return [item];
    } else if (linePrefix.trim() === '@') {
      const annotations = parseCedarPoliciesDoc(document).annotations;
      const items: vscode.CompletionItem[] = [];
      annotations.forEach((annotation) => {
        let item = new vscode.CompletionItem(
          '@' + annotation,
          vscode.CompletionItemKind.Property
        );
        item.insertText = new vscode.SnippetString(annotation + '("$1")$0');
        item.range = new vscode.Range(position, position);
        items.push(item);
      });
      return items;
    }
  } else if (context.triggerCharacter === '?') {
    // ?principal and ?resource
    let found = linePrefix
      .substring(0, linePrefix.length - 1)
      .match(SCOPE_REGEX);
    if (found?.groups) {
      const element = found?.groups.element;
      let item = new vscode.CompletionItem(
        '?' + element,
        vscode.CompletionItemKind.Variable
      );
      item.insertText = new vscode.SnippetString(element);
      item.range = new vscode.Range(position, position);
      return [item];
    }
  }

  return undefined;
};

const createSnippetItem = (
  label: string,
  description: string,
  insertText: vscode.SnippetString,
  range: vscode.Range
): vscode.CompletionItem => {
  const item = new vscode.CompletionItem(
    { label: label, description: description },
    vscode.CompletionItemKind.Snippet
  );
  item.insertText = insertText;
  item.range = range;

  return item;
};

const createPermitSnippetItems = (
  range: vscode.Range
): vscode.CompletionItem[] => {
  const item1 = createSnippetItem(
    'permit',
    'permit when',
    new vscode.SnippetString(
      'permit (principal, action, resource)\n' + 'when { ${0:Expr} };'
    ),
    range
  );

  const item2 = createSnippetItem(
    'permit',
    'permit',
    new vscode.SnippetString(
      'permit (\n' +
        '    principal == ${1:Path}::"${2:id}",\n' +
        '    action == Action::"${3:id}",\n' +
        '    resource == ${4:Path}::"${5:id}"\n' +
        ')$0;'
    ),
    range
  );

  return [item1, item2];
};

const createForbidSnippetItems = (
  range: vscode.Range
): vscode.CompletionItem[] => {
  const item1 = createSnippetItem(
    'forbid',
    'forbid when',
    new vscode.SnippetString(
      'forbid (principal, action, resource)\n' + 'when { ${0:Expr} };'
    ),
    range
  );

  const item2 = createSnippetItem(
    'forbid',
    'forbid unless',
    new vscode.SnippetString(
      'forbid (principal, action, resource)\n' + 'unless { ${0:Expr} };'
    ),
    range
  );

  return [item1, item2];
};

const createWhenSnippetItems = (
  range: vscode.Range
): vscode.CompletionItem[] => {
  const item1 = createSnippetItem(
    'when',
    'when condition',
    new vscode.SnippetString('when { ${0:Expr} }'),
    range
  );

  return [item1];
};

const createUnlessSnippetItems = (
  range: vscode.Range
): vscode.CompletionItem[] => {
  const item1 = createSnippetItem(
    'unless',
    'unless condition',
    new vscode.SnippetString('unless { ${0:Expr} }'),
    range
  );

  return [item1];
};

const SKIP_I_REGEX = /\b(principal|action|resource)\s+i$/;

const provideCedarInvokeCompletionItems = async (
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  context: vscode.CompletionContext
) => {
  const lineText = document.lineAt(position).text;
  const linePrefix = lineText.substring(0, position.character);
  const lineSuffix = lineText.substring(position.character);
  const range = new vscode.Range(
    new vscode.Position(position.line, position.character - 1),
    position
  );

  // some completion items are only suggests at beginning of line
  if (linePrefix.length === 1) {
    switch (linePrefix) {
      case 'p':
        return createPermitSnippetItems(range);
      case 'w':
        return createWhenSnippetItems(range);
      case 'u':
        return createUnlessSnippetItems(range);
      case 'f':
        return createForbidSnippetItems(range);
      default:
        return undefined;
    }
  }

  let typeOnly = false;
  let found = linePrefix.match(IS_REGEX);
  if (found) {
    typeOnly = true;
  } else {
    found = linePrefix.match(SCOPE_REGEX);
  }
  if (found?.groups) {
    const element = found?.groups.element;
    const trigger = found?.groups.trigger;
    const schemaDoc = await getSchemaTextDocument(undefined, document);
    if (schemaDoc) {
      typeOnly = typeOnly || lineSuffix.startsWith('::"');
      return createEntityItems(position, schemaDoc, element, trigger, typeOnly);
    }
  }

  const lastChar = linePrefix.substring(linePrefix.length - 1);
  if (lastChar === ' ') {
    // hotkey triggered completion
    if (linePrefix.endsWith(' has ')) {
      return provideCedarPeriodTriggerItems(
        position,
        linePrefix.substring(0, linePrefix.length - 5),
        document
      );
    }

    return createInvokeItems(position);
  }
  const penultimateChar = linePrefix.substring(
    linePrefix.length - 2,
    linePrefix.length - 1
  );
  if ([' ', '(', '{', '['].includes(penultimateChar)) {
    switch (lastChar) {
      case 'p':
        return [createVariableItem(range, 'principal')];

      case 'a':
        return [createVariableItem(range, 'action')];

      case 'r':
        return [createVariableItem(range, 'resource')];

      case 'c':
        return [createVariableItem(range, 'context')];

      case 'i':
        if (linePrefix.match(SKIP_I_REGEX)) {
          break;
        }
        return [createIpFunctionItem(range)];

      case 'd':
        return [createDecimalFunctionItem(range)];

      default:
        break;
    }
  }

  return undefined;
};

export class CedarCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ) {
    if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
      return await provideCedarTriggerCharacterCompletionItems(
        document,
        position,
        token,
        context
      );
    } else if (context.triggerKind === vscode.CompletionTriggerKind.Invoke) {
      return await provideCedarInvokeCompletionItems(
        document,
        position,
        token,
        context
      );
    }

    return undefined;
  }
}
