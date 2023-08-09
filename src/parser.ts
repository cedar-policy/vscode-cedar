// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { DEFAULT_RANGE } from './diagnostics';

// Cedar policies

export type PolicyRange = {
  range: vscode.Range;
  effectRange: vscode.Range;
};

type PolicyCacheItem = {
  version: number;
  policies: PolicyRange[];
};

const policyCache: Record<string, PolicyCacheItem> = {};

export const parseCedarDocPolicies = (
  cedarDoc: vscode.TextDocument,
  visitPolicy:
    | undefined
    | ((policyRange: PolicyRange, policyText: string) => void)
): PolicyRange[] => {
  // policy text is not cached, so check for no visitPolicy callback
  if (visitPolicy === undefined) {
    const cachedItem = policyCache[cedarDoc.uri.toString()];
    if (cachedItem && cachedItem.version === cedarDoc.version) {
      // console.log("parseCedarDocPolicies (cached)");
      return cachedItem.policies;
    }
  }

  const policies: PolicyRange[] = [];

  let tmpPolicy = '';
  let effectRange: vscode.Range = DEFAULT_RANGE;
  let startLine = 1;
  for (let i = 0; i < cedarDoc.lineCount; i++) {
    const textLine = cedarDoc.lineAt(i).text;
    if (
      textLine.trim().startsWith('permit') ||
      textLine.trim().startsWith('forbid')
    ) {
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
    if (
      textLine
        .substring(0, commentPos > -1 ? commentPos : textLine.length)
        .trim()
        .endsWith(';')
    ) {
      const policyRange = {
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
      effectRange = DEFAULT_RANGE;
    }
  }

  policyCache[cedarDoc.uri.toString()] = {
    version: cedarDoc.version,
    policies: policies,
  };

  return policies;
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

type EntityCacheItem = {
  version: number;
  entities: EntityRange[];
};

const entityCache: Record<string, EntityCacheItem> = {};

export const parseCedarDocEntities = (
  entitiesDoc: vscode.TextDocument,
  visitEntity:
    | undefined
    | ((entityRange: EntityRange, entityText: string) => void)
): EntityRange[] => {
  // entity text is not cached, so check for no visitEntity callback
  if (visitEntity === undefined) {
    const cachedItem = entityCache[entitiesDoc.uri.toString()];
    if (cachedItem && cachedItem.version === entitiesDoc.version) {
      // console.log("parseCedarDocEntities (cached)");
      return cachedItem.entities;
    }
  }

  const entities: EntityRange[] = [];

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
        depth1Property === 'attrs' &&
        attrsKeyRange &&
        Object.keys(attrsNameRanges).length > 0
      ) {
        // only enable the range if there are attribute names
        attrsRange = new vscode.Range(
          attrsKeyRange?.start,
          new vscode.Position(startLine, startCharacter + length)
        );
      } else if (
        depth === 1 &&
        depth1Property === 'parents' &&
        parentsKeyRange
      ) {
        parentsCount++;
      }
    },
    onArrayEnd(offset, length, startLine, startCharacter) {
      if (
        depth === 1 &&
        depth1Property === 'parents' &&
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
      if (pathSupplier().length === 1) {
        depth1Property = property;
        if (property === 'uid') {
          uidKeyRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        } else if (property === 'attrs') {
          attrsKeyRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        } else if (property === 'parents') {
          parentsKeyRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        }
      }
      if (pathSupplier().length === 2 && pathSupplier()[1] === 'attrs') {
        attrsNameRanges[property] = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );
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
      if (pathSupplier()[1] === 'uid') {
        if (pathSupplier()[jsonPathLen - 1] === 'type') {
          uidType = value;
          uid = `${uidType}::"${uidId}"`;
          uidTypeRange = new vscode.Range(
            new vscode.Position(startLine, startCharacter + 1),
            new vscode.Position(startLine, startCharacter + length - 1)
          );
        }
        if (pathSupplier()[jsonPathLen - 1] === 'id') {
          uidId = value;
          uid = `${uidType}::"${uidId}"`;
        }
        if (pathSupplier()[jsonPathLen - 1] === 'uid') {
          uid = value;
        }
      }
    },
  });

  entityCache[entitiesDoc.uri.toString()] = {
    version: entitiesDoc.version,
    entities: entities,
  };

  return entities;
};

// Cedar schema

export type SchemaRange = {
  etype: string;
  range: vscode.Range;
  etypeRange: vscode.Range;
};

type SchemaCacheItem = {
  version: number;
  entities: SchemaRange[];
};

const schemaCache: Record<string, SchemaCacheItem> = {};

export const parseCedarDocSchema = (
  schemaDoc: vscode.TextDocument,
  visitSchema:
    | undefined
    | ((schemaRange: SchemaRange, schemaText: string) => void)
): SchemaRange[] => {
  // schema text is not cached, so check for no visitSchema callback
  if (visitSchema === undefined) {
    const cachedItem = schemaCache[schemaDoc.uri.toString()];
    if (cachedItem && cachedItem.version === schemaDoc.version) {
      // console.log("parseCedarDocSchema (cached)");
      return cachedItem.entities;
    }
  }

  const entities: SchemaRange[] = [];

  let namespace: string = '';
  let etype: string = '';
  let etypeStart: vscode.Position | null = null;
  let etypeEnd: vscode.Position | null = null;
  let etypeRange: vscode.Range | null = null;
  let depth = 0;

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
            etype: etype,
            range: new vscode.Range(etypeStart, etypeEnd),
            etypeRange: etypeRange,
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
      if (pathSupplier().length === 0) {
        if (property) {
          namespace = property + '::';
        }
      } else if (pathSupplier().length === 2) {
        etypeStart = new vscode.Position(startLine, startCharacter);
        etypeRange = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );

        if (
          pathSupplier()[1] === 'entityTypes' ||
          pathSupplier()[1] === 'commonTypes'
        ) {
          etype = namespace + property;
        } else if (pathSupplier()[1] === 'actions') {
          etype = `${namespace}Action::"${property}"`;
        }
      }
    },
  });

  schemaCache[schemaDoc.uri.toString()] = {
    version: schemaDoc.version,
    entities: entities,
  };

  return entities;
};
