// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  parseCedarEntitiesDoc,
  parseCedarPoliciesDoc,
  parseCedarAuthDoc,
  parseCedarSchemaDoc,
  parseCedarTemplateLinksDoc,
  parseCedarJsonPolicyDoc,
  parseCedarTestsDoc,
  ReferencedRange,
  SchemaRange,
} from './parser';
import {
  getCedarTestFiles,
  getSchemaMemberUris,
  getSchemaSetForSchemaDoc,
  getSchemaTextDocument,
} from './fileutil';

/*
 * The schema files to find definitions in, which are the schema files of a
 * combined schema rather than the combined schema itself
 */
const schemaDefinitionDocs = async (
  schemaDoc: vscode.TextDocument,
): Promise<vscode.TextDocument[]> => {
  const uris = getSchemaMemberUris(schemaDoc);
  if (uris.length === 1 && uris[0] === schemaDoc.uri.toString()) {
    return Promise.resolve([schemaDoc]);
  }
  const docs: vscode.TextDocument[] = [];
  for (const uri of uris) {
    try {
      docs.push(await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)));
    } catch {
      // skip schema files which cannot be opened
    }
  }
  return Promise.resolve(docs);
};

export type SchemaDefinition = {
  doc: vscode.TextDocument;
  schemaRange: SchemaRange;
};

/**
 * Find the declaration of an entity type, common type, or action in schema
 * files, preferring the definition over an `external` declaration of it.
 */
export const findDefinition = (
  schemaDocs: vscode.TextDocument[],
  name: string,
  definedOnly: boolean = false,
): SchemaDefinition | undefined => {
  let externalDefinition: SchemaDefinition | undefined = undefined;
  for (const schemaDoc of schemaDocs) {
    for (let schemaRange of parseCedarSchemaDoc(schemaDoc).definitionRanges) {
      if (schemaRange.etype === name) {
        if (!schemaRange.external) {
          return { doc: schemaDoc, schemaRange: schemaRange };
        }
        externalDefinition = externalDefinition || {
          doc: schemaDoc,
          schemaRange: schemaRange,
        };
      }
    }
  }
  return definedOnly ? undefined : externalDefinition;
};

const findDefinitionLocation = (
  schemaDocs: vscode.TextDocument[],
  name: string,
  definedOnly: boolean = false,
): vscode.Location | null => {
  const definition = findDefinition(schemaDocs, name, definedOnly);
  return definition
    ? new vscode.Location(definition.doc.uri, definition.schemaRange.range)
    : null;
};

/**
 * The entity type, common type, or action at a position in a schema file,
 * either referenced or declared `external`, along with the schema files (of
 * the schema set the schema file belongs to) to find its definition in.
 */
export const findSchemaNameAtPosition = async (
  schemaDoc: vscode.TextDocument,
  position: vscode.Position,
): Promise<
  | {
      name: string;
      range: vscode.Range;
      external: boolean;
      docs: vscode.TextDocument[];
    }
  | undefined
> => {
  const schemaItem = parseCedarSchemaDoc(schemaDoc);
  let found: { name: string; range: vscode.Range; external: boolean } | null =
    null;
  for (let referenced of [
    ...schemaItem.referencedTypes,
    ...schemaItem.actionIds,
  ]) {
    if (referenced.range.contains(position)) {
      found = {
        name: referenced.name,
        range: referenced.range,
        external: false,
      };
      break;
    }
  }
  if (!found) {
    const declaration = schemaItem.definitionRanges.find(
      (schemaRange) =>
        schemaRange.external && schemaRange.etypeRange.contains(position),
    );
    if (declaration) {
      found = {
        name: declaration.etype,
        range: declaration.etypeRange,
        external: true,
      };
    }
  }
  if (!found) {
    return Promise.resolve(undefined);
  }

  // types may be defined by another schema file of the same schema set
  const set = await getSchemaSetForSchemaDoc(schemaDoc);
  const docs = set
    ? [schemaDoc, ...set.docs.filter((doc) => doc !== schemaDoc)]
    : [schemaDoc];

  return Promise.resolve({ ...found, docs });
};

const findSchemaDefinition = async (
  schemaDocs: vscode.TextDocument | vscode.TextDocument[],
  position: vscode.Position,
  referencedTypes: ReferencedRange[],
  actionIds: ReferencedRange[] = [],
): Promise<vscode.Definition | null | undefined> => {
  const docs = Array.isArray(schemaDocs)
    ? schemaDocs
    : await schemaDefinitionDocs(schemaDocs);
  for (let referencedType of [...referencedTypes, ...actionIds]) {
    if (referencedType.range.contains(position)) {
      // already matched position, so return even without a definition
      return Promise.resolve(findDefinitionLocation(docs, referencedType.name));
    }
  }
};

export class CedarEntitiesDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    cedarEntitiesDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarEntitiesDoc);
    if (schemaDoc) {
      const referencedTypes =
        parseCedarEntitiesDoc(cedarEntitiesDoc).referencedTypes;
      return findSchemaDefinition(schemaDoc, position, referencedTypes);
    }

    return null;
  }
}

export class CedarTemplateLinksDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    cedarTemplateLinksDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarTemplateLinksDoc);
    if (schemaDoc) {
      const referencedTypes = parseCedarTemplateLinksDoc(
        cedarTemplateLinksDoc,
      ).referencedTypes;
      return findSchemaDefinition(schemaDoc, position, referencedTypes);
    }

    return null;
  }
}

export class CedarAuthDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarAuthDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarAuthDoc);
    if (schemaDoc) {
      const authItem = parseCedarAuthDoc(cedarAuthDoc);
      const referencedTypes = authItem.referencedTypes;
      const actionIds = authItem.actionIds;
      return findSchemaDefinition(
        schemaDoc,
        position,
        referencedTypes,
        actionIds,
      );
    }

    return null;
  }
}

// resolve a policy id from a Cedar tests "reason" to the policy which declares
// it (an @id annotated policy, or a template link_id)
const findPolicyDefinition = async (
  cedarTestsDoc: vscode.TextDocument,
  position: vscode.Position,
  policyIds: ReferencedRange[],
): Promise<vscode.Definition | null | undefined> => {
  for (let policyId of policyIds) {
    if (policyId.range.contains(position)) {
      const { policyDocs, templateLinksDoc } =
        await getCedarTestFiles(cedarTestsDoc);

      for (let policyDoc of policyDocs) {
        for (let policyRange of parseCedarPoliciesDoc(policyDoc).policies) {
          if (policyRange.id === policyId.name) {
            return Promise.resolve(
              new vscode.Location(policyDoc.uri, policyRange.range),
            );
          }
        }
      }

      if (templateLinksDoc) {
        for (let link of parseCedarTemplateLinksDoc(templateLinksDoc).links) {
          if (link.id === policyId.name) {
            return Promise.resolve(
              new vscode.Location(templateLinksDoc.uri, link.range),
            );
          }
        }
      }

      // already matched position but didn't find definition, so return
      return null;
    }
  }
};

export class CedarTestsDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarTestsDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const testsItem = parseCedarTestsDoc(cedarTestsDoc);

    const policyDefinition = await findPolicyDefinition(
      cedarTestsDoc,
      position,
      testsItem.policyIds,
    );
    if (policyDefinition !== undefined) {
      return policyDefinition;
    }

    const schemaDoc = await getSchemaTextDocument(cedarTestsDoc);
    if (schemaDoc) {
      return findSchemaDefinition(
        schemaDoc,
        position,
        testsItem.referencedTypes,
        testsItem.actionIds,
      );
    }

    return null;
  }
}

export class CedarJsonDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarJsonDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarJsonDoc);
    if (schemaDoc) {
      const policyItem = parseCedarJsonPolicyDoc(cedarJsonDoc);
      const referencedTypes = policyItem.referencedTypes;
      const actionIds = policyItem.actionIds;
      return findSchemaDefinition(
        schemaDoc,
        position,
        referencedTypes,
        actionIds,
      );
    }

    return null;
  }
}

export class CedarSchemaDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    schemaDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const found = await findSchemaNameAtPosition(schemaDoc, position);
    if (!found) {
      return undefined;
    }

    // an `external` declaration goes to the schema file defining it
    return findDefinitionLocation(found.docs, found.name, found.external);
  }
}

export class CedarDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarDoc);
    if (schemaDoc) {
      const policyItem = parseCedarPoliciesDoc(cedarDoc);
      const referencedTypes = policyItem.referencedTypes;
      const actionIds = policyItem.actionIds;
      return findSchemaDefinition(
        schemaDoc,
        position,
        referencedTypes,
        actionIds,
      );
    }

    return null;
  }
}
