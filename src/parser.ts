// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { DEFAULT_RANGE } from './diagnostics';
import {
  EFFECT_ACTION_REGEX,
  EFFECT_ENTITY_REGEX,
  ENTITY_REGEX,
} from './regex';

/*
 * see https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
 * see https://github.com/microsoft/node-jsonc-parser
 */

const tokenTypes = [
  'namespace',
  'type',
  'property',
  'macro',
  'function',
  'variable',
  'keyword',
];
const tokenModifiers = ['declaration', 'deprecated'];
export const semanticTokensLegend = new vscode.SemanticTokensLegend(
  tokenTypes,
  tokenModifiers
);

const determineDefinitionRange = (
  type: string,
  line: number,
  start: number,
  length: number
) => {
  const pos = Math.max(type.lastIndexOf('::'));
  const typePos = pos === -1 ? 0 : pos + 2;
  const defRange = new vscode.Range(
    new vscode.Position(line, start + 1 + typePos),
    new vscode.Position(line, start + length)
  );

  return defRange;
};

// Cedar policies

export type PolicyRange = {
  id: string;
  range: vscode.Range;
  effectRange: vscode.Range;
};

type PolicyCacheItem = {
  version: number;
  policies: PolicyRange[];
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
  actions: vscode.Range[];
};

const policyCache: Record<string, PolicyCacheItem> = {};

const ID_ATTR = /@id\("(?<id>(.+))"\)/;

export const parseCedarPoliciesDoc = (
  cedarDoc: vscode.TextDocument,
  visitPolicy?:
    | undefined
    | ((policyRange: PolicyRange, policyText: string) => void)
): PolicyCacheItem => {
  // policy text is not cached, so check for no visitPolicy callback
  if (visitPolicy === undefined) {
    const cachedItem = policyCache[cedarDoc.uri.toString()];
    if (cachedItem && cachedItem.version === cedarDoc.version) {
      // console.log("parseCedarPoliciesDoc (cached)");
      return cachedItem;
    }
  }

  const policies: PolicyRange[] = [];
  const entityTypes: vscode.Range[] = [];
  const actions: vscode.Range[] = [];
  let count = 0;
  let id: string | null = null;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  let tmpPolicy = '';
  let effectRange: vscode.Range = DEFAULT_RANGE;
  let startLine = 1;
  for (let i = 0; i < cedarDoc.lineCount; i++) {
    const textLine = cedarDoc.lineAt(i).text;
    const trimmed = textLine.trim();
    if (id === null && trimmed.startsWith('@id(')) {
      const found = trimmed.match(ID_ATTR);
      if (found?.groups) {
        id = found.groups.id;
      }
    }
    if (trimmed.startsWith('permit') || trimmed.startsWith('forbid')) {
      const startPos = Math.max(
        0,
        textLine.indexOf('permit'),
        textLine.indexOf('forbid')
      );
      effectRange = new vscode.Range(
        new vscode.Position(i, startPos),
        new vscode.Position(i, startPos + 6)
      );
    }

    if (tmpPolicy.length === 0) {
      startLine = i;
    }
    if (!(tmpPolicy.length === 0 && textLine.trim().length === 0)) {
      tmpPolicy = tmpPolicy + textLine + '\n';
    }

    const commentPos = textLine.indexOf('//');
    const linePreComment = textLine.substring(
      0,
      commentPos > -1 ? commentPos : textLine.length
    );
    let foundArray = [...linePreComment.matchAll(EFFECT_ENTITY_REGEX)];
    foundArray.forEach((found) => {
      if (found && found?.groups) {
        const type = found?.groups.type;
        const startCharacter =
          linePreComment.indexOf(type + '::"', found.index) || 0;

        entityTypes.push(
          determineDefinitionRange(type, i, startCharacter - 1, type.length + 1)
        );
      }
    });

    foundArray = [...linePreComment.matchAll(EFFECT_ACTION_REGEX)];
    foundArray.forEach((found) => {
      if (found && found?.groups) {
        const id = found?.groups.id;
        const startCharacter =
          linePreComment.indexOf(`"${id}"`, found.index) || 0;

        actions.push(
          new vscode.Range(
            new vscode.Position(i, startCharacter + 1),
            new vscode.Position(i, startCharacter + id.length + 1)
          )
        );
      }
    });

    if (linePreComment.trim().endsWith(';')) {
      const policyRange = {
        id: id || `policy${count}`,
        range: new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(i, textLine.length)
        ),
        effectRange: effectRange,
      };
      policies.push(policyRange);

      if (visitPolicy) {
        visitPolicy(policyRange, tmpPolicy);
      }

      tmpPolicy = '';
      count++;
      id = null;
      effectRange = DEFAULT_RANGE;
    }
  }

  const cachedItem = {
    version: cedarDoc.version,
    policies: policies,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
    actions: actions,
  };
  policyCache[cedarDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

export const cedarTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarPoliciesDoc(cedarDoc).tokens;
  },
};

// Cedar policy (JSON)

type PolicyJsonCacheItem = {
  version: number;
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
  actions: vscode.Range[];
};

const policyJsonCache: Record<string, PolicyJsonCacheItem> = {};

export const parseCedarJsonPolicyDoc = (
  cedarJsonDoc: vscode.TextDocument
): PolicyJsonCacheItem => {
  let cachedItem = policyJsonCache[cedarJsonDoc.uri.toString()];
  if (cachedItem && cachedItem.version === cedarJsonDoc.version) {
    // console.log("parseCedarJsonPolicyDoc (cached)");
    return cachedItem;
  }

  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  const entityTypes: vscode.Range[] = [];
  const actions: vscode.Range[] = [];

  jsonc.visit(cedarJsonDoc.getText(), {
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 0) {
        if (['principal', 'action', 'resource'].includes(property)) {
          tokensBuilder.push(range, 'variable', []);
        }
      }
    },
    onLiteralValue(
      value,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      const property = pathSupplier()[0] as string;
      if (jsonPathLen === 1 && pathSupplier()[0] === 'effect') {
        tokensBuilder.push(range, 'keyword', []);
      }

      if (
        jsonPathLen === 3 &&
        pathSupplier()[0] === 'conditions' &&
        pathSupplier()[jsonPathLen - 1] === 'kind'
      ) {
        // most things directly under "kind" are a keyword
        tokensBuilder.push(range, 'keyword', []);
      } else if (
        jsonPathLen > 2 &&
        pathSupplier()[0] === 'action' &&
        pathSupplier()[jsonPathLen - 1] === 'id'
      ) {
        const innerRange = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );
        actions.push(innerRange);
      } else if (
        jsonPathLen > 2 &&
        pathSupplier()[jsonPathLen - 1] === 'type'
      ) {
        // most things directly under "type" are a type
        tokensBuilder.push(range, 'type', []);

        entityTypes.push(
          determineDefinitionRange(value, startLine, startCharacter, length - 1)
        );
      } else if (jsonPathLen > 2 && pathSupplier()[jsonPathLen - 1] === 'Var') {
        // most things directly under "Var" are a variable
        tokensBuilder.push(range, 'variable', []);
      }
    },
  });

  cachedItem = {
    version: cedarJsonDoc.version,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
    actions: actions,
  };
  policyJsonCache[cedarJsonDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

export const cedarJsonTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarJsonDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarJsonPolicyDoc(cedarJsonDoc).tokens;
  },
};

// Cedar entities

export type EntityRange = {
  uid: string;
  range: vscode.Range;
  uidKeyRange: vscode.Range;
  uidTypeRange: vscode.Range | null;
  attrsKeyRange: vscode.Range | null;
  attrsRange: vscode.Range | null;
  attrsNameRanges: Record<string, vscode.Range>;
  parentsKeyRange: vscode.Range | null;
  parentsRange: vscode.Range | null;
};

export type EntityCacheItem = {
  version: number;
  entities: EntityRange[];
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
};

const entityCache: Record<string, EntityCacheItem> = {};

export const parseCedarEntitiesDoc = (
  entitiesDoc: vscode.TextDocument,
  visitEntity?:
    | undefined
    | ((entityRange: EntityRange, entityText: string) => void)
): EntityCacheItem => {
  // entity text is not cached, so check for no visitEntity callback
  if (visitEntity === undefined) {
    const cachedItem = entityCache[entitiesDoc.uri.toString()];
    if (cachedItem && cachedItem.version === entitiesDoc.version) {
      // console.log("parseCedarEntitiesDoc (cached)");
      return cachedItem;
    }
  }

  let UID = 'uid';
  let TYPE = 'type';
  let ID = 'id';
  let ENTITY = '__entity';
  let ATTRS = 'attrs';
  let PARENTS = 'parents';

  // Amazon Verified Permissions entities format has a similar structure but different property names
  if (entitiesDoc.uri.toString().endsWith('.avpentities.json')) {
    UID = 'identifier';
    TYPE = 'entityType';
    ID = 'entityId';
    ENTITY = 'entityIdentifier';
    ATTRS = 'attributes';
  }

  const entities: EntityRange[] = [];
  const entityTypes: vscode.Range[] = [];

  let uidType: string = '';
  let uid: string = '';
  let uidId: string = '';
  let uidStart: vscode.Position | null = null;
  let uidEnd: vscode.Position | null = null;
  let uidKeyRange: vscode.Range | null = null;
  let uidTypeRange: vscode.Range | null = null;
  let attrsKeyRange: vscode.Range | null = null;
  let attrsRange: vscode.Range | null = null;
  let parentsKeyRange: vscode.Range | null = null;
  let parentsRange: vscode.Range | null = null;
  let depth = 0;
  let depth1Property = '';
  let attrsNameRanges: Record<string, vscode.Range> = {};
  let parentsCount = 0;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  jsonc.visit(entitiesDoc.getText(), {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      depth++;
      if (pathSupplier().length === 1) {
        uidStart = new vscode.Position(startLine, startCharacter);
      }
    },
    onObjectEnd(offset, length, startLine, startCharacter) {
      depth--;
      if (depth === 0) {
        uidEnd = new vscode.Position(startLine, startCharacter + length);
        if (uidStart && uidEnd && uidKeyRange) {
          const entityRange: EntityRange = {
            uid: uid,
            range: new vscode.Range(uidStart, uidEnd),
            uidKeyRange: uidKeyRange,
            uidTypeRange: uidTypeRange,
            attrsKeyRange: attrsKeyRange,
            attrsRange: attrsRange,
            attrsNameRanges: attrsNameRanges,
            parentsKeyRange: parentsKeyRange,
            parentsRange: parentsRange,
          };
          entities.push(entityRange);
        }
        attrsKeyRange = null;
        attrsRange = null;
        attrsNameRanges = {};
        parentsKeyRange = null;
        parentsRange = null;
        parentsCount = 0;
      } else if (
        depth === 1 &&
        depth1Property === ATTRS &&
        attrsKeyRange &&
        Object.keys(attrsNameRanges).length > 0
      ) {
        // only enable the range if there are attribute names
        attrsRange = new vscode.Range(
          attrsKeyRange?.start,
          new vscode.Position(startLine, startCharacter + length)
        );
      } else if (depth === 1 && depth1Property === PARENTS && parentsKeyRange) {
        parentsCount++;
      }
    },
    onArrayEnd(offset, length, startLine, startCharacter) {
      if (
        depth === 1 &&
        depth1Property === PARENTS &&
        parentsKeyRange &&
        parentsCount > 0
      ) {
        // only enable the range if there are objects inside parents array
        parentsRange = new vscode.Range(
          parentsKeyRange?.start,
          new vscode.Position(startLine, startCharacter + length)
        );
      }
    },
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const innerRange = new vscode.Range(
        new vscode.Position(startLine, startCharacter + 1),
        new vscode.Position(startLine, startCharacter + length - 1)
      );
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 1) {
        depth1Property = property;
        if (property === UID) {
          uidKeyRange = innerRange;
        } else if (property === ATTRS) {
          attrsKeyRange = innerRange;
        } else if (property === PARENTS) {
          parentsKeyRange = innerRange;
        }
      } else if (jsonPathLen === 2 && pathSupplier()[1] === ATTRS) {
        // anything directly under "attrs" is an property
        tokensBuilder.push(range, 'property', []);
        attrsNameRanges[property] = innerRange;
      } else if (property === '__expr') {
        // treat "__expr" as a deprecated macro
        tokensBuilder.push(range, 'macro', ['deprecated']);
      } else if (property === '__entity' || property === '__extn') {
        // treat "__entity" and "__extn" as a macro
        tokensBuilder.push(range, 'macro', []);
      }
    },
    onLiteralValue(
      value,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      if (pathSupplier()[1] === UID) {
        if (pathSupplier()[jsonPathLen - 1] === TYPE) {
          uidType = value;
          uid = `${uidType}::"${uidId}"`;
          uidTypeRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        }
        if (pathSupplier()[jsonPathLen - 1] === ID) {
          uidId = value;
          uid = `${uidType}::"${uidId}"`;
        }
        if (pathSupplier()[jsonPathLen - 1] === UID) {
          uid = value;
          let found = uid.match(ENTITY_REGEX);
          if (found?.groups) {
            const type = found?.groups.type;
            const typeRange = new vscode.Range(
              new vscode.Position(startLine, startCharacter + 1),
              new vscode.Position(startLine, startCharacter + type.length + 1)
            );
            tokensBuilder.push(typeRange, TYPE, []);

            entityTypes.push(
              determineDefinitionRange(
                type,
                startLine,
                startCharacter,
                type.length + 1
              )
            );
          }
        }
      }

      if (
        jsonPathLen > 2 &&
        pathSupplier()[jsonPathLen - 1] === TYPE &&
        (pathSupplier()[1] === UID ||
          pathSupplier()[1] === PARENTS ||
          pathSupplier()[jsonPathLen - 2] === ENTITY)
      ) {
        // most things directly under "type" are a type
        tokensBuilder.push(range, 'type', []);

        entityTypes.push(
          determineDefinitionRange(value, startLine, startCharacter, length - 1)
        );
      } else if (
        jsonPathLen > 2 &&
        pathSupplier()[jsonPathLen - 1] === 'fn' &&
        pathSupplier()[jsonPathLen - 2] === '__extn'
      ) {
        // things under "__extn" then "fn" are a function
        tokensBuilder.push(range, 'function', []);
      }
    },
  });

  const cachedItem = {
    version: entitiesDoc.version,
    entities: entities,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
  };
  entityCache[entitiesDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

// analyze the Cedar entities JSON documents and return semantic tokens
export const entitiesTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarEntitiesDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarEntitiesDoc(cedarEntitiesDoc).tokens;
  },
};

// Cedar template links

export type TemplateLinkRange = {
  id: string;
  range: vscode.Range;
  linkIdRange: vscode.Range;
};

export type TemplateLinksCacheItem = {
  version: number;
  links: TemplateLinkRange[];
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
};

const templateLinksCache: Record<string, TemplateLinksCacheItem> = {};

export const parseCedarTemplateLinksDoc = (
  cedarTemplateLinksDoc: vscode.TextDocument
): TemplateLinksCacheItem => {
  let cachedItem = templateLinksCache[cedarTemplateLinksDoc.uri.toString()];
  if (cachedItem && cachedItem.version === cedarTemplateLinksDoc.version) {
    // console.log("parseCedarTemplateLinksDoc (cached)");
    return cachedItem;
  }

  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  let linkId: string = '';
  let linkStart: vscode.Position | null = null;
  let linkEnd: vscode.Position | null = null;
  let linkIdRange: vscode.Range | null = null;
  let depth = 0;
  const links: TemplateLinkRange[] = [];
  const entityTypes: vscode.Range[] = [];

  jsonc.visit(cedarTemplateLinksDoc.getText(), {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      depth++;
      if (pathSupplier().length === 1) {
        linkStart = new vscode.Position(startLine, startCharacter);
      }
    },
    onObjectEnd(offset, length, startLine, startCharacter) {
      depth--;
      if (depth === 0) {
        linkEnd = new vscode.Position(startLine, startCharacter + length);
        if (linkStart && linkEnd && linkIdRange) {
          const templateLinkRange: TemplateLinkRange = {
            id: linkId,
            range: new vscode.Range(linkStart, linkEnd),
            linkIdRange: linkIdRange,
          };
          links.push(templateLinkRange);
        }
      }
    },
    onLiteralValue(
      value,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const jsonPathLen = pathSupplier().length;
      if (pathSupplier()[1] === 'link_id') {
        linkId = value;
      } else if (pathSupplier()[1] === 'args' && jsonPathLen === 3) {
        let found = value.match(ENTITY_REGEX);
        if (found?.groups) {
          const type = found?.groups.type;
          const typeRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + type.length + 1)
          );
          tokensBuilder.push(typeRange, 'type', []);

          entityTypes.push(
            determineDefinitionRange(
              type,
              startLine,
              startCharacter,
              type.length + 1
            )
          );
        }
      }
    },
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 1) {
        if (property === 'link_id') {
          linkIdRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        }
      } else if (jsonPathLen === 2) {
        if (['?principal', '?resource'].includes(property)) {
          tokensBuilder.push(range, 'variable', []);
        }
      }
    },
  });

  cachedItem = {
    version: cedarTemplateLinksDoc.version,
    links: links,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
  };
  templateLinksCache[cedarTemplateLinksDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

// analyze the Cedar template links JSON documents and return semantic tokens
export const templateLinksTokensProvider: vscode.DocumentSemanticTokensProvider =
  {
    provideDocumentSemanticTokens(
      cedarTemplateLinksDoc: vscode.TextDocument
    ): vscode.ProviderResult<vscode.SemanticTokens> {
      return parseCedarTemplateLinksDoc(cedarTemplateLinksDoc).tokens;
    },
  };

// Cedar authorization requests (PARC)

export type AuthCacheItem = {
  version: number;
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
  actions: vscode.Range[];
};

const authCache: Record<string, AuthCacheItem> = {};

export const parseCedarAuthDoc = (
  cedarAuthDoc: vscode.TextDocument
): AuthCacheItem => {
  let cachedItem = authCache[cedarAuthDoc.uri.toString()];
  if (cachedItem && cachedItem.version === cedarAuthDoc.version) {
    // console.log("parseCedarAuthDoc (cached)");
    return cachedItem;
  }

  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
  const entityTypes: vscode.Range[] = [];
  const actions: vscode.Range[] = [];

  jsonc.visit(cedarAuthDoc.getText(), {
    onLiteralValue(
      value,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const jsonPathLen = pathSupplier().length;
      const property = pathSupplier()[0] as string;
      if (
        ['principal', 'action', 'resource'].includes(property) &&
        jsonPathLen === 1
      ) {
        let found = value.match(ENTITY_REGEX);
        if (found?.groups) {
          const type = found?.groups.type;
          const typeRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + type.length + 1)
          );
          tokensBuilder.push(typeRange, 'type', []);

          if (property === 'action') {
            const actionId = found?.groups.id;
            const pos = value.lastIndexOf(actionId);
            if (pos > -1) {
              actions.push(
                new vscode.Range(
                  new vscode.Position(startLine, startCharacter + pos + 2),
                  new vscode.Position(
                    startLine,
                    startCharacter + pos + 2 + actionId.length
                  )
                )
              );
            }
          } else {
            entityTypes.push(
              determineDefinitionRange(
                type,
                startLine,
                startCharacter,
                type.length + 1
              )
            );
          }
        }
      }
    },
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 0) {
        if (['principal', 'action', 'resource', 'context'].includes(property)) {
          tokensBuilder.push(range, 'variable', []);
        }
      }
    },
  });

  cachedItem = {
    version: cedarAuthDoc.version,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
    actions: actions,
  };
  authCache[cedarAuthDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

// analyze the Cedar request JSON documents and return semantic tokens
export const authTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarAuthDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarAuthDoc(cedarAuthDoc).tokens;
  },
};

// Cedar schema

export type SchemaRange = {
  collection: 'commonTypes' | 'entityTypes' | 'actions';
  etype: string;
  deftype: string;
  range: vscode.Range;
  etypeRange: vscode.Range;
  symbol: vscode.SymbolKind;
};

type SchemaCacheItem = {
  version: number;
  entities: SchemaRange[];
  tokens: vscode.SemanticTokens;
  entityTypes: vscode.Range[];
  actions: vscode.Range[];
};

const schemaCache: Record<string, SchemaCacheItem> = {};

export const parseCedarSchemaDoc = (
  schemaDoc: vscode.TextDocument,
  visitSchema?:
    | undefined
    | ((schemaRange: SchemaRange, schemaText: string) => void)
): SchemaCacheItem => {
  // schema text is not cached, so check for no visitSchema callback
  if (visitSchema === undefined) {
    const cachedItem = schemaCache[schemaDoc.uri.toString()];
    if (cachedItem && cachedItem.version === schemaDoc.version) {
      // console.log("parseCedarDocSchema (cached)");
      return cachedItem;
    }
  }

  const entities: SchemaRange[] = [];
  const entityTypes: vscode.Range[] = [];
  const actions: vscode.Range[] = [];

  let namespace: string = '';
  let collection: 'commonTypes' | 'entityTypes' | 'actions' = 'entityTypes';
  let etype: string = '';
  let deftype: string = '';
  let etypeStart: vscode.Position | null = null;
  let etypeEnd: vscode.Position | null = null;
  let etypeRange: vscode.Range | null = null;
  let depth = 0;
  let symbol = vscode.SymbolKind.Class;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  jsonc.visit(schemaDoc.getText(), {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      depth++;
    },
    onObjectEnd(offset, length, startLine, startCharacter) {
      depth--;
      if (depth === 3) {
        etypeEnd = new vscode.Position(startLine, startCharacter + length);
        if (etypeStart && etypeEnd && etypeRange) {
          const schemaRange: SchemaRange = {
            collection: collection,
            etype: etype,
            deftype: deftype,
            range: new vscode.Range(etypeStart, etypeEnd),
            etypeRange: etypeRange,
            symbol: symbol,
          };
          entities.push(schemaRange);
        }
      }
    },
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 0) {
        if (property) {
          namespace = property + '::';
        }
        tokensBuilder.push(range, 'namespace', ['declaration']);
      } else if (jsonPathLen === 2) {
        etypeStart = new vscode.Position(startLine, startCharacter);
        etypeRange = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );
        deftype = property;
        tokensBuilder.push(range, 'type', ['declaration']);

        if (pathSupplier()[1] === 'commonTypes') {
          collection = 'commonTypes';
          etype = namespace + property;
          symbol = vscode.SymbolKind.Struct;
        } else if (pathSupplier()[1] === 'entityTypes') {
          collection = 'entityTypes';
          etype = namespace + property;
          symbol = vscode.SymbolKind.Class;
        } else if (pathSupplier()[1] === 'actions') {
          collection = 'actions';
          etype = `${namespace}Action::"${property}"`;
          symbol = vscode.SymbolKind.Function;
        }
      } else if (pathSupplier()[jsonPathLen - 1] === 'attributes') {
        // anything directly under "attributes" is an property declaration
        tokensBuilder.push(range, 'property', ['declaration']);
      }
    },
    onLiteralValue(
      value,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const jsonPathLen = pathSupplier().length;
      const range = new vscode.Range(
        new vscode.Position(startLine, startCharacter),
        new vscode.Position(startLine, startCharacter + length)
      );
      if (
        // anything directly under "memberOfTypes" under "entityTypes" is a type
        jsonPathLen === 5 &&
        pathSupplier()[1] === 'entityTypes' &&
        pathSupplier()[3] === 'memberOfTypes'
      ) {
        tokensBuilder.push(range, 'type', []);
        if (pathSupplier()[3] === 'memberOfTypes') {
          entityTypes.push(
            determineDefinitionRange(
              value,
              startLine,
              startCharacter,
              length - 1
            )
          );
        }
      } else if (
        // anything directly under "principalTypes" or "resourceTypes" under "actions" is a type
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        (pathSupplier()[4] === 'principalTypes' ||
          pathSupplier()[4] === 'resourceTypes')
      ) {
        tokensBuilder.push(range, 'type', []);
        entityTypes.push(
          determineDefinitionRange(value, startLine, startCharacter, length - 1)
        );
      } else if (
        // "id" or "type" under "memberOf" under "actions" is a type
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        pathSupplier()[3] === 'memberOf' &&
        (pathSupplier()[5] === 'id' || pathSupplier()[5] === 'type')
      ) {
        tokensBuilder.push(range, 'type', []);
        if (pathSupplier()[5] === 'id') {
          actions.push(
            new vscode.Range(
              new vscode.Position(startLine, startCharacter + 1),
              new vscode.Position(startLine, startCharacter + length - 1)
            )
          );
        }
      } else if (pathSupplier()[jsonPathLen - 1] === 'name') {
        // anything directly under "name" is (probably) a type
        if (value === 'ipaddr' || value === 'decimal') {
          tokensBuilder.push(range, 'function', []);
        } else {
          tokensBuilder.push(range, 'type', []);
          entityTypes.push(
            determineDefinitionRange(
              value,
              startLine,
              startCharacter,
              length - 1
            )
          );
        }
      }
    },
  });

  const cachedItem = {
    version: schemaDoc.version,
    entities: entities,
    tokens: tokensBuilder.build(),
    entityTypes: entityTypes,
    actions: actions,
  };
  schemaCache[schemaDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

export const schemaTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarSchemaDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarSchemaDoc(cedarSchemaDoc).tokens;
  },
};
