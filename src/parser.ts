// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as jsonc from 'jsonc-parser';
import { DEFAULT_RANGE } from './diagnostics';
import { ENTITY_REGEXG } from './regex';

/*
 * see https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
 * see https://github.com/microsoft/node-jsonc-parser
 */

const tokenTypes = [
  'namespace',
  'type',
  'struct',
  'property',
  'macro',
  'function',
  'variable',
  'operator',
  'keyword',
  'decorator',
  'string',
];
const tokenModifiers = ['declaration', 'deprecated', 'readonly'];
export const semanticTokensLegend = new vscode.SemanticTokensLegend(
  tokenTypes,
  tokenModifiers
);

const makeRange = (
  startLine: number,
  startCharacter: number,
  length: number,
  offset = 0
): vscode.Range => {
  return new vscode.Range(
    new vscode.Position(startLine, startCharacter + offset),
    new vscode.Position(startLine, startCharacter + length - offset)
  );
};

const indexOfNonSpace = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ' ') {
      return i;
    }
  }
  return -1;
};

const ensureNamespace = (type: string, namespace: string) => {
  const pos = type.indexOf('::');
  if (pos === -1) {
    return namespace + type;
  } else {
    return type;
  }
};

const determineReferenceRange = (
  type: string,
  line: number,
  start: number,
  length: number
) => {
  const pos = type.lastIndexOf('::');
  const typePos = pos === -1 ? 0 : pos + 2;
  const defRange = new vscode.Range(
    new vscode.Position(line, start + typePos),
    new vscode.Position(line, start + length - 1)
  );

  return defRange;
};

export type ReferencedRange = {
  name: string;
  range: vscode.Range;
};

const determineEntitiesInString = (
  value: string,
  startLine: number,
  startCharacter: number,
  tokensBuilder: vscode.SemanticTokensBuilder,
  referencedTypes: ReferencedRange[]
) => {
  let foundArray = [...value.matchAll(ENTITY_REGEXG)];
  foundArray.forEach((found) => {
    if (found?.groups) {
      const type = found?.groups.type;
      const typeRange = makeRange(startLine, startCharacter + 1, type.length);
      tokensBuilder.push(typeRange, 'type', []);
      referencedTypes.push({
        name: type,
        range: determineReferenceRange(
          type,
          startLine,
          startCharacter + 1,
          type.length + 1
        ),
      });
    }
  });
};

/*
 * Cedar policies
 */

type EntityTypes = {
  principals: string[];
  resources: string[];
  actions: string[];
};

export type PolicyRange = {
  id: string;
  range: vscode.Range;
  effectRange: vscode.Range;
  entityTypes: EntityTypes | undefined;
};

type PolicyCacheItem = {
  version: number;
  policies: PolicyRange[];
  tokens: vscode.SemanticTokens;
  referencedTypes: ReferencedRange[];
  actionIds: ReferencedRange[];
  annotations: Set<String>;
};

const policyCache: Record<string, PolicyCacheItem> = {};

const ID_ANNOTATION = /@id\("(?<id>(.+))"\)/;
const ANNOTATION = /@(?<name>[_a-zA-Z][_a-zA-Z0-9]*)\(".*"\)/;

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
  const referencedTypes: ReferencedRange[] = [];
  const actionIds: ReferencedRange[] = [];
  const annotations = new Set<String>(['id']);
  let count = 0;
  let id: string | null = null;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  let tmpPolicy = '';
  let effectRange: vscode.Range = DEFAULT_RANGE;
  let startLine = 1;
  for (let i = 0; i < cedarDoc.lineCount; i++) {
    const textLine = cedarDoc.lineAt(i).text;
    const trimmed = textLine.trim();
    if (id === null && trimmed.startsWith('@')) {
      let found = trimmed.match(ID_ANNOTATION);
      if (found?.groups) {
        id = found.groups.id;
      } else {
        found = trimmed.match(ANNOTATION);
        if (found?.groups && found?.groups.name) {
          // collect annotation names for completion items
          annotations.add(found.groups.name);
        }
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

    let foundArray = [...linePreComment.matchAll(ENTITY_REGEXG)];
    foundArray.forEach((found) => {
      if (found && found?.groups) {
        const type = found?.groups.type;
        if (type === 'Action' || type.endsWith('::Action')) {
          const id = found?.groups.id;
          const startCharacter =
            linePreComment.indexOf(`"${id}"`, found.index) || 0;
          actionIds.push({
            name: `${type}::"${id}"`,
            range: makeRange(i, startCharacter + 1, id.length),
          });
        } else {
          referencedTypes.push({
            name: type,
            range: determineReferenceRange(
              type,
              i,
              found.index as number,
              type.length + 1
            ),
          });
        }
      }
    });

    if (
      // end of policy or
      linePreComment.trim().endsWith(';') ||
      // end of file
      (i === cedarDoc.lineCount - 1 && !effectRange.isEqual(DEFAULT_RANGE))
    ) {
      const policyRange = {
        id: id || `policy${count}`,
        range: new vscode.Range(
          new vscode.Position(startLine, 0),
          new vscode.Position(i, textLine.length)
        ),
        effectRange: effectRange,
        entityTypes: undefined,
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
    referencedTypes: referencedTypes,
    actionIds: actionIds,
    annotations: annotations,
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

/*
 * Cedar policy (JSON)
 */

type PolicyJsonCacheItem = {
  version: number;
  tokens: vscode.SemanticTokens;
  referencedTypes: ReferencedRange[];
  actionIds: ReferencedRange[];
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

  const referencedTypes: ReferencedRange[] = [];
  const actionIds: ReferencedRange[] = [];
  let tmpActionType = '';

  jsonc.visit(cedarJsonDoc.getText(), {
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const range = makeRange(startLine, startCharacter, length);
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 0) {
        if (['principal', 'action', 'resource'].includes(property)) {
          tokensBuilder.push(range, 'variable', ['readonly']);
        }
      } else if (
        jsonPathLen === 1 &&
        pathSupplier()[jsonPathLen - 1] === 'annotations'
      ) {
        tokensBuilder.push(range, 'decorator', []);
      } else if (
        ['&&', '||', '==', '!=', '>=', '<=', '<', '>', '.'].includes(property)
      ) {
        tokensBuilder.push(range, 'operator', []);
      } else if (
        ['if', 'then', 'else'].includes(property) &&
        pathSupplier()[jsonPathLen - 1] === 'if-then-else'
      ) {
        tokensBuilder.push(range, 'keyword', []);
      } else if (
        property === '__entity' &&
        pathSupplier()[jsonPathLen - 1] === 'Value'
      ) {
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
      const range = makeRange(startLine, startCharacter, length);
      const jsonPathLen = pathSupplier().length;
      const property = pathSupplier()[0] as string;
      if (jsonPathLen === 1 && pathSupplier()[0] === 'effect') {
        tokensBuilder.push(range, 'keyword', []);
      }

      if (
        jsonPathLen === 2 &&
        pathSupplier()[jsonPathLen - 1] === 'slot' &&
        ['?principal', '?resource'].includes(value)
      ) {
        tokensBuilder.push(range, 'variable', []);
      }

      if (jsonPathLen === 2 && pathSupplier()[jsonPathLen - 1] === 'op') {
        tokensBuilder.push(range, 'operator', []);
      }

      if (jsonPathLen > 2 && pathSupplier()[jsonPathLen - 1] === 'type') {
        // most things directly under "type" are a type
        tokensBuilder.push(range, 'type', []);

        if (value === 'Action' || value.endsWith('::Action')) {
          tmpActionType = value;
        } else {
          referencedTypes.push({
            name: value,
            range: determineReferenceRange(
              value,
              startLine,
              startCharacter + 1,
              length - 1
            ),
          });
        }
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
        // type / id under top level 'action'
        (pathSupplier()[0] === 'action' ||
          // type / id directly under '__entity'
          pathSupplier()[jsonPathLen - 2] === '__entity')
      ) {
        if (pathSupplier()[jsonPathLen - 1] === 'id') {
          actionIds.push({
            name: `${tmpActionType}::"${value}"`,
            range: makeRange(startLine, startCharacter, length, 1),
          });
          tmpActionType = '';
        }
      } else if (jsonPathLen > 2 && pathSupplier()[jsonPathLen - 1] === 'Var') {
        // most things directly under "Var" are a variable
        tokensBuilder.push(range, 'variable', []);
      }
    },
  });

  cachedItem = {
    version: cedarJsonDoc.version,
    tokens: tokensBuilder.build(),
    referencedTypes: referencedTypes,
    actionIds: actionIds,
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

/*
 * Cedar entities
 */

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
  referencedTypes: ReferencedRange[];
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
  const referencedTypes: ReferencedRange[] = [];

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
      const range = makeRange(startLine, startCharacter, length);
      const innerRange = makeRange(startLine, startCharacter, length, 1);
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
      const range = makeRange(startLine, startCharacter, length);
      const jsonPathLen = pathSupplier().length;
      if (pathSupplier()[1] === UID) {
        if (pathSupplier()[jsonPathLen - 1] === TYPE) {
          uidType = value;
          uid = `${uidType}::"${uidId}"`;
          uidTypeRange = makeRange(startLine, startCharacter, length, 1);
        }
        if (pathSupplier()[jsonPathLen - 1] === ID) {
          uidId = value;
          uid = `${uidType}::"${uidId}"`;
        }
      }

      // entities as strings under UID or string array element under PARENTS
      if (
        (jsonPathLen === 2 && pathSupplier()[1] === UID) ||
        (jsonPathLen === 3 && pathSupplier()[1] === PARENTS)
      ) {
        if (pathSupplier()[1] === UID) {
          uid = value;
          uidTypeRange = makeRange(startLine, startCharacter, length);
        }
        determineEntitiesInString(
          value,
          startLine,
          startCharacter,
          tokensBuilder,
          referencedTypes
        );
      }

      if (
        jsonPathLen > 2 &&
        pathSupplier()[jsonPathLen - 1] === TYPE &&
        (pathSupplier()[1] === UID ||
          pathSupplier()[1] === PARENTS ||
          (pathSupplier()[1] === ATTRS && jsonPathLen > 3) ||
          pathSupplier()[jsonPathLen - 2] === ENTITY)
      ) {
        // most things directly under "type" are a type
        tokensBuilder.push(range, 'type', []);
        referencedTypes.push({
          name: value,
          range: determineReferenceRange(
            value,
            startLine,
            startCharacter + 1,
            length - 1
          ),
        });
      } else if (
        jsonPathLen > 2 &&
        pathSupplier()[jsonPathLen - 1] === 'fn' &&
        (pathSupplier()[jsonPathLen - 2] === '__extn' ||
          ['ip', 'decimal'].includes(value))
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
    referencedTypes: referencedTypes,
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

/*
 * Cedar template links
 */

export type TemplateLinkRange = {
  id: string;
  range: vscode.Range;
  linkIdRange: vscode.Range;
};

export type TemplateLinksCacheItem = {
  version: number;
  links: TemplateLinkRange[];
  tokens: vscode.SemanticTokens;
  referencedTypes: ReferencedRange[];
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
  const referencedTypes: ReferencedRange[] = [];

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
        determineEntitiesInString(
          value,
          startLine,
          startCharacter,
          tokensBuilder,
          referencedTypes
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
      const range = makeRange(startLine, startCharacter, length);
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 1) {
        if (property === 'link_id') {
          linkIdRange = makeRange(startLine, startCharacter, length, 1);
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
    referencedTypes: referencedTypes,
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

/*
 * Cedar authorization requests (PARC)
 */
export type AuthCacheItem = {
  version: number;
  tokens: vscode.SemanticTokens;
  referencedTypes: ReferencedRange[];
  actionIds: ReferencedRange[];
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
  const referencedTypes: ReferencedRange[] = [];
  const actionIds: ReferencedRange[] = [];

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
        let foundArray = [...value.matchAll(ENTITY_REGEXG)];
        foundArray.forEach((found) => {
          if (found?.groups) {
            const type = found?.groups.type;
            const typeRange = makeRange(
              startLine,
              startCharacter + 1,
              type.length
            );
            tokensBuilder.push(typeRange, 'type', []);

            if (property === 'action') {
              const actionId = found?.groups.id;
              const pos = value.lastIndexOf(actionId);
              if (pos > -1) {
                actionIds.push({
                  name: value,
                  range: makeRange(
                    startLine,
                    startCharacter + pos + 2,
                    actionId.length
                  ),
                });
              }
            } else {
              referencedTypes.push({
                name: type,
                range: determineReferenceRange(
                  type,
                  startLine,
                  startCharacter + 1,
                  type.length + 1
                ),
              });
            }
          }
        });
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
      const range = makeRange(startLine, startCharacter, length);
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
    referencedTypes: referencedTypes,
    actionIds: actionIds,
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

export const PRIMITIVE_TYPES = [
  'String',
  'Long',
  'Boolean',
  'Record',
  'Set',
  'Entity',
  'Extension',
];

export type SchemaRange = {
  collection: 'commonTypes' | 'entityTypes' | 'actions';
  etype: string;
  range: vscode.Range;
  etypeRange: vscode.Range;
  symbol: vscode.SymbolKind;
};

type SchemaCompletionData = {
  description: string;
  children?: SchemaCompletionRecord;
};
export type SchemaCompletionRecord = Record<string, SchemaCompletionData>;
type SchemaCacheItem = {
  version: number;
  definitionRanges: SchemaRange[];
  tokens: vscode.SemanticTokens;
  referencedTypes: ReferencedRange[];
  actionIds: ReferencedRange[];
  completions: Record<string, SchemaCompletionRecord>;
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

  let cachedItem: SchemaCacheItem;

  if (schemaDoc.languageId === 'cedarschema') {
    cachedItem = parseCedarSchemaNaturalDoc(schemaDoc, visitSchema);

    // get JSON
    const translateResult = cedar.translateSchemaToJSON(schemaDoc.getText());
    if (translateResult.success && translateResult.schema) {
      // update cachedItem
      const tmpCachedItem = parseCedarSchemaJSONText(translateResult.schema);
      cachedItem.completions = tmpCachedItem.completions;
    }
    translateResult.free();
  } else {
    cachedItem = parseCedarSchemaJSONText(schemaDoc.getText());
  }

  cachedItem.version = schemaDoc.version;
  schemaCache[schemaDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

const parseCedarSchemaJSONText = (schemaText: string): SchemaCacheItem => {
  const definitionRanges: SchemaRange[] = [];
  const referencedTypes: ReferencedRange[] = [];
  const actionIds: ReferencedRange[] = [];
  const completions: Record<string, SchemaCompletionRecord> = {};

  let namespace: string = '';
  let collection: 'commonTypes' | 'entityTypes' | 'actions' = 'entityTypes';
  let etype: string = '';
  let etypeStart: vscode.Position | null = null;
  let etypeEnd: vscode.Position | null = null;
  let etypeRange: vscode.Range | null = null;
  let tmpMemberOf: { id: string; type: string; range: vscode.Range | null } = {
    id: '',
    type: '',
    range: null,
  };
  let tmpAttribute: {
    key: string;
    type: string;
    element: string;
    range: vscode.Range | null;
  } = {
    key: '',
    type: '',
    element: '',
    range: null,
  };

  let tmpSchemaCompletionRecord: SchemaCompletionRecord = {};
  const tmpSchemaCompletionRecordStack: Array<SchemaCompletionRecord> = [];
  const tmpAttributeDepthStack: Array<number> = [];
  function captureAttribute(value: string) {
    tmpSchemaCompletionRecord[tmpAttribute.key] = { description: value };
    tmpSchemaCompletionRecord[tmpAttribute.key] = { description: value };

    if (value === 'Record') {
      const children: SchemaCompletionRecord = {};
      tmpSchemaCompletionRecord[tmpAttribute.key].children = children;
      tmpSchemaCompletionRecordStack.push(tmpSchemaCompletionRecord);
      tmpSchemaCompletionRecord = children;

      tmpAttributeDepthStack.push(depth);
    }

    tmpAttribute = {
      key: '',
      type: '',
      element: '',
      range: null,
    };
  }

  let depth = 0;
  let symbol = vscode.SymbolKind.Class;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  jsonc.visit(schemaText, {
    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      depth++;
    },
    onObjectEnd(offset, length, startLine, startCharacter) {
      if (tmpAttributeDepthStack.length) {
        if (tmpAttributeDepthStack.at(-1) === depth) {
          tmpAttributeDepthStack.pop();
          tmpSchemaCompletionRecord =
            tmpSchemaCompletionRecordStack.pop() as SchemaCompletionRecord;
        }
      }
      depth--;
      if (depth === 3) {
        completions[etype] = tmpSchemaCompletionRecord;
        tmpSchemaCompletionRecord = {};
        etypeEnd = new vscode.Position(startLine, startCharacter + length);
        if (etypeStart && etypeEnd && etypeRange) {
          const schemaRange: SchemaRange = {
            collection: collection,
            etype: etype,
            range: new vscode.Range(etypeStart, etypeEnd),
            etypeRange: etypeRange,
            symbol: symbol,
          };
          definitionRanges.push(schemaRange);
        }
      } else if (depth === 4) {
        if (tmpMemberOf.id && tmpMemberOf.range) {
          actionIds.push({
            name: tmpMemberOf.type
              ? `${tmpMemberOf.type}::"${tmpMemberOf.id}"`
              : `${namespace}Action::"${tmpMemberOf.id}"`,
            range: tmpMemberOf.range,
          });
        }
        tmpMemberOf = {
          id: '',
          type: '',
          range: null,
        };
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
      const range = makeRange(startLine, startCharacter, length);
      const jsonPathLen = pathSupplier().length;
      if (jsonPathLen === 0) {
        if (property) {
          namespace = property + '::';
        } else {
          namespace = '';
        }
        tokensBuilder.push(range, 'namespace', ['declaration']);
      } else if (jsonPathLen === 2) {
        etypeStart = new vscode.Position(startLine, startCharacter);
        etypeRange = makeRange(startLine, startCharacter, length, 1);

        if (pathSupplier()[1] === 'commonTypes') {
          tokensBuilder.push(range, 'struct', ['declaration']);
          collection = 'commonTypes';
          etype = namespace + property;
          symbol = vscode.SymbolKind.Struct;
        } else if (pathSupplier()[1] === 'entityTypes') {
          tokensBuilder.push(range, 'type', ['declaration']);
          collection = 'entityTypes';
          etype = namespace + property;
          symbol = vscode.SymbolKind.Class;
        } else if (pathSupplier()[1] === 'actions') {
          tokensBuilder.push(range, 'type', ['declaration']);
          collection = 'actions';
          etype = `${namespace}Action::"${property}"`;
          symbol = vscode.SymbolKind.Function;
        }
      } else if (pathSupplier()[jsonPathLen - 1] === 'attributes') {
        // anything directly under "attributes" is an property declaration
        tokensBuilder.push(range, 'property', ['declaration']);

        tmpAttribute.key = property;
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
      const range = makeRange(startLine, startCharacter, length);
      if (
        // anything directly under "memberOfTypes" under "entityTypes" is a type
        jsonPathLen === 5 &&
        pathSupplier()[1] === 'entityTypes' &&
        pathSupplier()[3] === 'memberOfTypes'
      ) {
        tokensBuilder.push(range, 'type', []);
        if (pathSupplier()[3] === 'memberOfTypes') {
          referencedTypes.push({
            name: ensureNamespace(value, namespace),
            range: determineReferenceRange(
              value,
              startLine,
              startCharacter + 1,
              length - 1
            ),
          });
        }
      } else if (
        // anything directly under "principalTypes" or "resourceTypes" under "actions" is a type
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        (pathSupplier()[4] === 'principalTypes' ||
          pathSupplier()[4] === 'resourceTypes')
      ) {
        tokensBuilder.push(range, 'type', []);
        referencedTypes.push({
          name: ensureNamespace(value, namespace),
          range: determineReferenceRange(
            value,
            startLine,
            startCharacter + 1,
            length - 1
          ),
        });
      } else if (
        // "id" or "type" under "memberOf" under "actions" is a type
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        pathSupplier()[3] === 'memberOf' &&
        (pathSupplier()[5] === 'id' || pathSupplier()[5] === 'type')
      ) {
        tokensBuilder.push(range, 'type', []);

        // save off id, range, and (optional) type
        // actionIds is updated inside onObjectEnd
        if (pathSupplier()[5] === 'type') {
          tmpMemberOf.type = value;
        } else if (pathSupplier()[5] === 'id') {
          tmpMemberOf.id = value;
          tmpMemberOf.range = makeRange(startLine, startCharacter, length, 1);
        }
      } else if (pathSupplier()[jsonPathLen - 1] === 'type') {
        // anything directly under "type" not matching a primitive type (probably) a common type
        if (!PRIMITIVE_TYPES.includes(value)) {
          tokensBuilder.push(range, 'struct', []);
          referencedTypes.push({
            name: ensureNamespace(value, namespace),
            range: determineReferenceRange(
              value,
              startLine,
              startCharacter + 1,
              length - 1
            ),
          });
        }
        if (pathSupplier()[jsonPathLen - 3] === 'attributes') {
          tmpAttribute.type = value;
          if (!['Set', 'Entity', 'Extension'].includes(value)) {
            captureAttribute(value);
          }
        } else if (pathSupplier()[jsonPathLen - 2] === 'element') {
          if (value !== 'Entity') {
            tmpAttribute.element = value;
            // 'type' under 'element' indicates parent is a Set
            captureAttribute(`Set<${value}>`);
          }
        } else if (
          pathSupplier()[jsonPathLen - 2] === 'shape' ||
          pathSupplier()[jsonPathLen - 2] === 'context'
        ) {
          if (value !== 'Record') {
            // the whole shape is a commonType, so just link to it
            tmpSchemaCompletionRecord =
              completions[ensureNamespace(value, namespace)];
          }
        }
      } else if (pathSupplier()[jsonPathLen - 1] === 'name') {
        // anything directly under "name" is (probably) a type
        if (value === 'ipaddr' || value === 'decimal') {
          tokensBuilder.push(range, 'function', []);
        } else {
          tokensBuilder.push(range, 'type', []);
          referencedTypes.push({
            name: ensureNamespace(value, namespace),
            range: determineReferenceRange(
              value,
              startLine,
              startCharacter + 1,
              length - 1
            ),
          });
        }
        if (pathSupplier()[jsonPathLen - 2] === 'element') {
          tmpAttribute.element = ensureNamespace(value, namespace);
          // 'type' under 'element' indicates parent is a Set of Entity
          captureAttribute(`Set<${tmpAttribute.element}>`);
        } else if (pathSupplier()[jsonPathLen - 3] === 'attributes') {
          if (value === 'ipaddr' || value === 'decimal') {
            captureAttribute(value);
          } else {
            captureAttribute(ensureNamespace(value, namespace));
          }
        }
      }
    },
  });

  const cachedItem = {
    version: 0,
    definitionRanges: definitionRanges,
    tokens: tokensBuilder.build(),
    referencedTypes: referencedTypes,
    actionIds: actionIds,
    completions: completions,
  };

  return cachedItem;
};

const parseCedarSchemaNaturalDoc = (
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

  const definitionRanges: SchemaRange[] = [];
  const referencedTypes: ReferencedRange[] = [];
  const actionIds: ReferencedRange[] = [];
  const completions: Record<string, SchemaCompletionRecord> = {};

  let symbol = vscode.SymbolKind.Class;
  const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);

  let declarations: Record<string, vscode.Range | null> = {};
  let namespace: string = '';
  let collection: 'commonTypes' | 'entityTypes' | 'actions' = 'entityTypes';

  function determineRange(
    textLine: string,
    i: number,
    match: string,
    startPos: number = 0,
    margin: number = 0
  ): vscode.Range | null {
    let range = null;
    const idx = textLine.indexOf(match, startPos);
    if (idx > -1) {
      range = new vscode.Range(
        new vscode.Position(i, idx + margin),
        new vscode.Position(i, idx + match.length - margin)
      );
    }
    return range;
  }

  function parseCedarSchemaEntityItem(
    item: string,
    line: number,
    offset: number
  ) {
    offset += indexOfNonSpace(item);
    item = item.trim();
    const range = new vscode.Range(line, offset, line, offset + item.length);
    tokensBuilder.push(range, 'type', []);
    referencedTypes.push({
      name: ensureNamespace(item, namespace),
      range: determineReferenceRange(item, line, offset, item.length + 1),
    });
  }
  function parseCedarSchemaActionItem(
    item: string,
    line: number,
    offset: number
  ) {
    const trimmed = item.trim();
    const quotePosition = item.indexOf('"');
    if (quotePosition > -1) {
      let foundArray = [...item.matchAll(ENTITY_REGEXG)];
      foundArray.forEach((found) => {
        if (found?.groups && found.index !== undefined) {
          const type = found?.groups.type;
          const typeRange = makeRange(line, offset + found.index, type.length);
          tokensBuilder.push(typeRange, 'type', []);
        }
      });
      actionIds.push({
        name: trimmed,
        range: makeRange(
          line,
          offset + quotePosition,
          trimmed.length - quotePosition
        ),
      });
    } else {
      const range = makeRange(line, offset, item.length);
      tokensBuilder.push(range, 'string', []);
      actionIds.push({
        name: `${namespace}Action::"${trimmed}"`,
        range: range,
      });
    }
  }

  let declarationStartLine = -1;
  for (let i = 0; i < schemaDoc.lineCount; i++) {
    const textLine = schemaDoc.lineAt(i).text;
    const commentPos = textLine.indexOf('//');
    let linePreComment = textLine
      .substring(0, commentPos > -1 ? commentPos : textLine.length)
      .trim();
    if (linePreComment.length > 0) {
      if (linePreComment.startsWith('namespace')) {
        const match = linePreComment.match(
          /^namespace\s+(([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*)\s*{/
        );
        if (match) {
          namespace = match[1] + '::';
          linePreComment = linePreComment.substring(match[0].length).trim();
        }
      } else if (declarationStartLine === -1 && linePreComment === '}') {
        // assume closing } not inside declaration is end of namespace
        namespace = '';
      }
      // https://docs.cedarpolicy.com/schema/human-readable-schema.html#schema-commonTypes
      if (linePreComment.startsWith('type')) {
        declarationStartLine = i;
        symbol = vscode.SymbolKind.Struct;
        collection = 'commonTypes';
        const match = linePreComment.match(
          /^type\s+([_a-zA-Z][_a-zA-Z0-9]*)\s*=/
        );
        if (match) {
          const range = determineRange(textLine, i, match[1], match.index || 0);
          if (range) {
            tokensBuilder.push(range, 'struct', ['declaration']);
          }
          declarations[namespace + match[1]] = range;
        }
      }
      // https://docs.cedarpolicy.com/schema/human-readable-schema.html#schema-entityTypes
      if (linePreComment.startsWith('entity')) {
        declarationStartLine = i;
        symbol = vscode.SymbolKind.Class;
        collection = 'entityTypes';
        const match = linePreComment.match(
          /^entity\s+(([_a-zA-Z][_a-zA-Z0-9]*,\s*)*[_a-zA-Z][_a-zA-Z0-9]*)\s*( in|=|{|;|$)/
        );
        if (match) {
          let startPos = match.index || 0;
          const types = match[1].split(',');
          types.forEach((type) => {
            const range = determineRange(textLine, i, type.trim(), startPos);
            if (range) {
              tokensBuilder.push(range, 'type', ['declaration']);
            }
            declarations[namespace + type.trim()] = range;
            startPos = startPos + type.length + 1;
          });
        }
      }
      // https://docs.cedarpolicy.com/schema/human-readable-schema.html#schema-actions
      if (linePreComment.startsWith('action')) {
        declarationStartLine = i;
        symbol = vscode.SymbolKind.Function;
        collection = 'actions';
        let match = linePreComment.match(/^action\s+(("(.+?)",\s*)*"(.+?)")/);
        match = linePreComment.match(
          /^action\s+([_a-zA-Z0-9, "]*)( in| appliesTo|;|$)/
        );
        if (match) {
          let startPos = match.index || textLine.indexOf('action') + 6;
          const ids = match[1].split(',');
          ids.forEach((id) => {
            id = id.trim();
            const isQuoted = id.startsWith('"') && id.endsWith('"');
            if (isQuoted) {
              var range = determineRange(textLine, i, id, startPos, 1);
              id = id.substring(1, id.length - 1);
            } else {
              var range = determineRange(textLine, i, id, startPos);
            }
            if (range) {
              tokensBuilder.push(range, 'string', []);
              declarations[`${namespace}Action::"${id}"`] = range;
            }
            startPos = startPos + id.length + (isQuoted ? 3 : 1);
          });
        }
      }
      const leftBracketIndex = linePreComment.indexOf('[');
      if (leftBracketIndex > -1) {
        let foundArray = [
          ...linePreComment.matchAll(/\[([_a-zA-Z0-9:, "]+)\]/g),
        ];
        let padding = textLine.indexOf('[') - linePreComment.indexOf('[');
        foundArray.forEach((found) => {
          if (found.length > 1 && found.index !== undefined) {
            let offset = padding + found.index + 1;
            const items = found[1].split(',');
            if (linePreComment.startsWith('action')) {
              items.forEach((item) => {
                parseCedarSchemaActionItem(item, i, offset);
                offset += item.length + 1;
              });
            } else {
              items.forEach((item) => {
                parseCedarSchemaEntityItem(item, i, offset);
                offset += item.length + 1;
              });
            }
          }
        });
      } else {
        const inIndex = linePreComment.indexOf(' in ');
        if (inIndex > -1) {
          const match = linePreComment.match(
            / in\s+(([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*)/
          );
          if (match) {
            const matchIndex = textLine.indexOf(
              match[1],
              textLine.indexOf(' in ')
            );
            if (linePreComment.startsWith('action')) {
              parseCedarSchemaActionItem(match[1], i, matchIndex);
            } else {
              parseCedarSchemaEntityItem(match[1], i, matchIndex);
            }
          }
        }
      }
      const colonIndex = textLine.indexOf(':');
      if (declarationStartLine !== -1 && colonIndex > -1) {
        // inside a declaration
        const match = textLine.match(
          /^\s*(?:("[^"]+"|[_a-zA-Z][_a-zA-Z0-9]*))[?]?\s*:\s*(?:Set\s*<\s*)?(?<type>([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*)\s*(?:\s*>\s*)?/
        );
        if (match && match.groups?.type) {
          let type = match.groups?.type;
          if (
            !(
              type.startsWith('__cedar::') ||
              ['Long', 'String', 'Bool', 'Set'].includes(type)
            )
          ) {
            const idx = textLine.indexOf(type, colonIndex);
            if (idx > -1) {
              const range = makeRange(i, idx, type.length);
              if (['ipaddr', 'decimal'].includes(type)) {
                tokensBuilder.push(range, 'function', []);
              } else {
                tokensBuilder.push(range, 'type', []);

                referencedTypes.push({
                  name: ensureNamespace(type, namespace),
                  range: range,
                });
              }
            }
          }
        }
      }
      if (
        // end of type, entity, or action declaration
        linePreComment.trim().endsWith(';')
      ) {
        const range = new vscode.Range(
          new vscode.Position(declarationStartLine, 0),
          new vscode.Position(i, textLine.length)
        );
        Object.entries(declarations).forEach(([key, value]) => {
          const schemaRange: SchemaRange = {
            collection: collection,
            etype: key,
            range: range,
            etypeRange: value || range,
            symbol: symbol,
          };
          definitionRanges.push(schemaRange);
        });

        declarationStartLine = -1;
        declarations = {};
      }
    }
  }

  const cachedItem = {
    version: schemaDoc.version,
    definitionRanges: definitionRanges,
    tokens: tokensBuilder.build(),
    referencedTypes: referencedTypes,
    actionIds: actionIds,
    completions: completions,
  };
  schemaCache[schemaDoc.uri.toString()] = cachedItem;

  return cachedItem;
};

export const traversePropertyChain = (
  completions: Record<string, SchemaCompletionRecord>,
  properties: string[],
  entityType: string
): { lastType: string; completion: SchemaCompletionRecord | undefined } => {
  let lastType = '';
  let completion: SchemaCompletionRecord | undefined = completions[entityType];
  for (let i = 1; i < properties.length; i++) {
    if (completion && completion[properties[i]]) {
      lastType = completion[properties[i]].description;
      if (completion[properties[i]].children) {
        // Record attributes
        completion = completion[properties[i]].children;
      } else {
        // common type or entity type
        completion = completions[completion[properties[i]].description];
      }
    } else {
      completion = undefined;
      lastType = '';
    }
  }

  return { lastType, completion };
};

export const schemaTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarSchemaDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    return parseCedarSchemaDoc(cedarSchemaDoc).tokens;
  },
};
