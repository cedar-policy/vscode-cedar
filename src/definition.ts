// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  parseCedarEntitiesDoc,
  parseCedarPoliciesDoc,
  parseCedarAuthDoc,
  parseCedarSchemaDoc,
  parseCedarTemplateLinksDoc,
  parseCedarJsonPolicyDoc,
} from './parser';
import { getSchemaTextDocument } from './fileutil';

const findSchemaDefinition = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
  entityTypeRanges: vscode.Range[],
  actionRanges: vscode.Range[],
  schemaDoc: vscode.TextDocument
): Promise<vscode.Definition | null | undefined> => {
  // TODO: update from O(n^2) to something more efficient
  const schemaItem = parseCedarSchemaDoc(schemaDoc);
  const schemaEntityTypeRanges = schemaItem.entities;
  for (let entityTypeRange of entityTypeRanges) {
    if (entityTypeRange.contains(position)) {
      const text = doc.getText(entityTypeRange);
      for (let schemaRange of schemaEntityTypeRanges) {
        if (
          schemaRange.collection === 'entityTypes' &&
          schemaRange.deftype === text
        ) {
          const loc = new vscode.Location(schemaDoc.uri, schemaRange.range);
          return Promise.resolve(loc);
        }
      }
      // already matched position but didn't find definition, so return
      return null;
    }
  }
  for (let actionRange of actionRanges) {
    if (actionRange.contains(position)) {
      const text = doc.getText(actionRange);
      for (let schemaRange of schemaEntityTypeRanges) {
        if (
          schemaRange.collection === 'actions' &&
          schemaRange.deftype === text
        ) {
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
    const schemaDoc = await getSchemaTextDocument(undefined, cedarEntitiesDoc);
    if (schemaDoc) {
      const entityTypeRanges =
        parseCedarEntitiesDoc(cedarEntitiesDoc).entityTypes;
      return findSchemaDefinition(
        cedarEntitiesDoc,
        position,
        entityTypeRanges,
        [],
        schemaDoc
      );
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
    const schemaDoc = await getSchemaTextDocument(
      undefined,
      cedarTemplateLinksDoc
    );
    if (schemaDoc) {
      const entityTypeRanges = parseCedarTemplateLinksDoc(
        cedarTemplateLinksDoc
      ).entityTypes;
      return findSchemaDefinition(
        cedarTemplateLinksDoc,
        position,
        entityTypeRanges,
        [],
        schemaDoc
      );
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
    const schemaDoc = await getSchemaTextDocument(undefined, cedarAuthDoc);
    if (schemaDoc) {
      const authItem = parseCedarAuthDoc(cedarAuthDoc);
      const entityTypeRanges = authItem.entityTypes;
      const actionRanges = authItem.actions;
      return findSchemaDefinition(
        cedarAuthDoc,
        position,
        entityTypeRanges,
        actionRanges,
        schemaDoc
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
    const schemaDoc = await getSchemaTextDocument(undefined, cedarJsonDoc);
    if (schemaDoc) {
      const authItem = parseCedarJsonPolicyDoc(cedarJsonDoc);
      const entityTypeRanges = authItem.entityTypes;
      const actionRanges = authItem.actions;
      return findSchemaDefinition(
        cedarJsonDoc,
        position,
        entityTypeRanges,
        actionRanges,
        schemaDoc
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
    const entityTypeRanges = schemaItem.entityTypes;
    const actionRanges = schemaItem.actions;
    return findSchemaDefinition(
      schemaDoc,
      position,
      entityTypeRanges,
      actionRanges,
      schemaDoc
    );
  }
}

export class CedarDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    cedarDoc: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | null | undefined> {
    const schemaDoc = await getSchemaTextDocument(undefined, cedarDoc);
    if (schemaDoc) {
      const policyItem = parseCedarPoliciesDoc(cedarDoc);
      const entityTypeRanges = policyItem.entityTypes;
      const actionRanges = policyItem.actions;
      return findSchemaDefinition(
        cedarDoc,
        position,
        entityTypeRanges,
        actionRanges,
        schemaDoc
      );
    }

    return null;
  }
}
