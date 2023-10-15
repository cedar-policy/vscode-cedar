// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  parseCedarDocEntities,
  parseCedarDocPolicies,
  parseCedarDocSchema,
} from './parser';
import { getSchemaTextDocument } from './fileutil';

const findSchemaDefinition = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
  definitionRanges: vscode.Range[],
  schemaDoc: vscode.TextDocument
): Promise<vscode.Definition | null | undefined> => {
  // TODO: update from O(n^2) to something more efficient
  const schemaRanges = parseCedarDocSchema(schemaDoc).entities;
  for (let definitionRange of definitionRanges) {
    if (definitionRange.contains(position)) {
      const text = doc.getText(definitionRange);
      for (let schemaRange of schemaRanges) {
        if (schemaRange.deftype === text) {
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
      const definitionRanges =
        parseCedarDocEntities(cedarEntitiesDoc).definitions;
      return findSchemaDefinition(
        cedarEntitiesDoc,
        position,
        definitionRanges,
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
    const definitionRanges = parseCedarDocSchema(schemaDoc).definitions;
    return findSchemaDefinition(
      schemaDoc,
      position,
      definitionRanges,
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
      const definitionRanges = parseCedarDocPolicies(cedarDoc).definitions;
      return findSchemaDefinition(
        cedarDoc,
        position,
        definitionRanges,
        schemaDoc
      );
    }

    return null;
  }
}
