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
  ReferencedRange,
} from './parser';
import { getSchemaTextDocument } from './fileutil';

const findSchemaDefinition = async (
  schemaDoc: vscode.TextDocument,
  position: vscode.Position,
  referencedTypes: ReferencedRange[],
  actionIds: ReferencedRange[] = []
): Promise<vscode.Definition | null | undefined> => {
  // TODO: update from O(n^2) to something more efficient
  const schemaItem = parseCedarSchemaDoc(schemaDoc);
  const schemaDefinitionRanges = schemaItem.definitionRanges;
  for (let referencedType of referencedTypes) {
    if (referencedType.range.contains(position)) {
      for (let schemaRange of schemaDefinitionRanges) {
        if (schemaRange.etype === referencedType.name) {
          const loc = new vscode.Location(schemaDoc.uri, schemaRange.range);
          return Promise.resolve(loc);
        }
      }
      // already matched position but didn't find definition, so return
      return null;
    }
  }

  for (let actionId of actionIds) {
    if (actionId.range.contains(position)) {
      for (let schemaRange of schemaDefinitionRanges) {
        if (schemaRange.etype === actionId.name) {
          const loc = new vscode.Location(schemaDoc.uri, schemaRange.range);
          return Promise.resolve(loc);
        }
      }
      // already matched position but didn't find definition, so return
      return null;
    }
  }
};

export class CedarEntitiesDefinitionProvider
  implements vscode.DefinitionProvider
{
  async provideDefinition(
    cedarEntitiesDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
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
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(cedarTemplateLinksDoc);
    if (schemaDoc) {
      const referencedTypes = parseCedarTemplateLinksDoc(
        cedarTemplateLinksDoc
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
    token: vscode.CancellationToken
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
        actionIds
      );
    }

    return null;
  }
}

export class CedarJsonDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarJsonDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
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
        actionIds
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
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | null | undefined> {
    const schemaItem = parseCedarSchemaDoc(schemaDoc);
    const referencedTypes = schemaItem.referencedTypes;
    const actionIds = schemaItem.actionIds;
    return findSchemaDefinition(
      schemaDoc,
      position,
      referencedTypes,
      actionIds
    );
  }
}

export class CedarDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
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
        actionIds
      );
    }

    return null;
  }
}
