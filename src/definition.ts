// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
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
export const schemaDefinitionDocs = async (
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

/**
 * The location of a definition. When a hover already shows the definition,
 * the location is the (empty) start of its name, so holding the modifier key
 * over the reference doesn't show the same definition again as a preview.
 */
const definitionLocation = (
  definition: SchemaDefinition,
  hoverShown: boolean = false,
): vscode.Location =>
  hoverShown
    ? new vscode.Location(
        definition.doc.uri,
        definition.schemaRange.etypeRange.start,
      )
    : new vscode.Location(definition.doc.uri, definition.schemaRange.range);

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

/**
 * The entity types and actions referenced by each kind of Cedar file, which
 * go to (and hover with) their schema definitions.
 */
export type SchemaReferences = (doc: vscode.TextDocument) => ReferencedRange[];

export const cedarReferences: SchemaReferences = (doc) => {
  const item = parseCedarPoliciesDoc(doc);
  return [...item.referencedTypes, ...item.actionIds];
};
export const cedarEntitiesReferences: SchemaReferences = (doc) =>
  parseCedarEntitiesDoc(doc).referencedTypes;
export const cedarTemplateLinksReferences: SchemaReferences = (doc) =>
  parseCedarTemplateLinksDoc(doc).referencedTypes;
export const cedarAuthReferences: SchemaReferences = (doc) => {
  const item = parseCedarAuthDoc(doc);
  return [...item.referencedTypes, ...item.actionIds];
};
export const cedarTestsReferences: SchemaReferences = (doc) => {
  const item = parseCedarTestsDoc(doc);
  return [...item.referencedTypes, ...item.actionIds];
};
export const cedarJsonReferences: SchemaReferences = (doc) => {
  const item = parseCedarJsonPolicyDoc(doc);
  return [...item.referencedTypes, ...item.actionIds];
};

/**
 * The entity type or action referenced at a position in a Cedar file, along
 * with its definition in the schema files.
 */
export const findReferencedDefinition = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
  references: SchemaReferences,
): Promise<
  | { referenced: ReferencedRange; definition: SchemaDefinition | undefined }
  | undefined
> => {
  const referenced = references(doc).find((r) => r.range.contains(position));
  if (!referenced) {
    return undefined;
  }
  const schemaDoc = await getSchemaTextDocument(doc);
  if (!schemaDoc) {
    return { referenced, definition: undefined };
  }
  const docs = await schemaDefinitionDocs(schemaDoc);
  return { referenced, definition: findDefinition(docs, referenced.name) };
};

// already matched position, so return null even without a definition
const findSchemaDefinition = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
  references: SchemaReferences,
): Promise<vscode.Definition | null | undefined> => {
  const found = await findReferencedDefinition(doc, position, references);
  if (!found) {
    return undefined;
  }
  // CedarDefinitionHoverProvider shows the definition
  return found.definition ? definitionLocation(found.definition, true) : null;
};

export class CedarEntitiesDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    cedarEntitiesDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    return findSchemaDefinition(
      cedarEntitiesDoc,
      position,
      cedarEntitiesReferences,
    );
  }
}

/**
 * A Cedar policy (or template, or template link) declaring a policy id, which
 * may be Cedar or JSON.
 */
export type PolicyDefinition = {
  doc: vscode.TextDocument;
  range: vscode.Range;
};

/**
 * Find the policy id referenced at a position, along with the policy which
 * declares it.
 */
export type PolicyFinder = (
  doc: vscode.TextDocument,
  position: vscode.Position,
) => Promise<
  | { referenced: ReferencedRange; definition: PolicyDefinition | undefined }
  | undefined
>;

// the Cedar policy with an @id (or a template with that id)
const findCedarPolicy = (
  policyDocs: vscode.TextDocument[],
  id: string,
): PolicyDefinition | undefined => {
  for (let policyDoc of policyDocs) {
    for (let policyRange of parseCedarPoliciesDoc(policyDoc).policies) {
      if (policyRange.id === id) {
        return { doc: policyDoc, range: policyRange.range };
      }
    }
  }
  return undefined;
};

/**
 * A template_id in a Cedar template links file goes to the Cedar policy
 * template with that id.
 */
export const findTemplateLinksPolicy: PolicyFinder = async (doc, position) => {
  const referenced = parseCedarTemplateLinksDoc(doc).templateIds.find(
    (templateId) => templateId.range.contains(position),
  );
  if (!referenced) {
    return undefined;
  }
  const { policyDocs } = await getCedarTestFiles(doc);
  return {
    referenced,
    definition: findCedarPolicy(policyDocs, referenced.name),
  };
};

/**
 * A policy id from a Cedar tests "reason" goes to the policy which declares it
 * (an @id annotated policy, or a template link_id).
 */
export const findTestsPolicy: PolicyFinder = async (doc, position) => {
  const referenced = parseCedarTestsDoc(doc).policyIds.find((policyId) =>
    policyId.range.contains(position),
  );
  if (!referenced) {
    return undefined;
  }
  const { policyDocs, templateLinksDoc } = await getCedarTestFiles(doc);
  let definition = findCedarPolicy(policyDocs, referenced.name);
  if (!definition && templateLinksDoc) {
    const link = parseCedarTemplateLinksDoc(templateLinksDoc).links.find(
      (link) => link.id === referenced.name,
    );
    if (link) {
      definition = { doc: templateLinksDoc, range: link.range };
    }
  }
  return { referenced, definition };
};

/**
 * A template link's templateId in a Cedar JSON policy set goes to the template
 * in the same policy set.
 */
export const findJsonPolicy: PolicyFinder = async (doc, position) => {
  const policyItem = parseCedarJsonPolicyDoc(doc);
  const referenced = policyItem.templateIds.find((templateId) =>
    templateId.range.contains(position),
  );
  if (!referenced) {
    return undefined;
  }
  if (!policyItem.policyIds.some((id) => id.name === referenced.name)) {
    return { referenced, definition: undefined };
  }
  // the "id": { ... } property of "templates" (or "staticPolicies")
  const tree = jsonc.parseTree(doc.getText());
  const node = tree
    ? (jsonc.findNodeAtLocation(tree, ['templates', referenced.name]) ??
      jsonc.findNodeAtLocation(tree, ['staticPolicies', referenced.name]))
    : undefined;
  const property = node?.parent;
  if (!property) {
    return { referenced, definition: undefined };
  }
  // from the start of the line, so the hover keeps relative indentation
  const range = new vscode.Range(
    doc.positionAt(property.offset).with({ character: 0 }),
    doc.positionAt(property.offset + property.length),
  );
  return { referenced, definition: { doc, range } };
};

/**
 * Go to the policy declaring a policy id. The location is the (empty) start
 * of the policy, since CedarPolicyHoverProvider shows the policy, so holding
 * the modifier key over the policy id doesn't show it again as a preview.
 */
const findPolicyDefinition = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
  findPolicy: PolicyFinder,
): Promise<vscode.Definition | null | undefined> => {
  const found = await findPolicy(doc, position);
  if (!found) {
    return undefined;
  }
  // already matched position, so return null even without a definition
  return found.definition
    ? new vscode.Location(
        found.definition.doc.uri,
        found.definition.range.start,
      )
    : null;
};

export class CedarTemplateLinksDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    cedarTemplateLinksDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const policyDefinition = await findPolicyDefinition(
      cedarTemplateLinksDoc,
      position,
      findTemplateLinksPolicy,
    );
    if (policyDefinition !== undefined) {
      return policyDefinition;
    }

    return findSchemaDefinition(
      cedarTemplateLinksDoc,
      position,
      cedarTemplateLinksReferences,
    );
  }
}

export class CedarAuthDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarAuthDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    return findSchemaDefinition(cedarAuthDoc, position, cedarAuthReferences);
  }
}

export class CedarTestsDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarTestsDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const policyDefinition = await findPolicyDefinition(
      cedarTestsDoc,
      position,
      findTestsPolicy,
    );
    if (policyDefinition !== undefined) {
      return policyDefinition;
    }

    return findSchemaDefinition(cedarTestsDoc, position, cedarTestsReferences);
  }
}

export class CedarJsonDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarJsonDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    const policyDefinition = await findPolicyDefinition(
      cedarJsonDoc,
      position,
      findJsonPolicy,
    );
    if (policyDefinition !== undefined) {
      return policyDefinition;
    }

    return findSchemaDefinition(cedarJsonDoc, position, cedarJsonReferences);
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
    const definition = findDefinition(found.docs, found.name, found.external);
    if (!definition) {
      return null;
    }
    // CedarSchemaHoverProvider shows a definition in another schema file
    return definitionLocation(
      definition,
      !definition.schemaRange.external && definition.doc !== schemaDoc,
    );
  }
}

export class CedarDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null | undefined> {
    return findSchemaDefinition(cedarDoc, position, cedarReferences);
  }
}
