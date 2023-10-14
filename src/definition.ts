// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  parseCedarDocEntities,
  parseCedarDocPolicies,
  parseCedarDocSchema,
} from './parser';
import { getSchemaTextDocument } from './fileutil';

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
      const schemaRanges = parseCedarDocSchema(schemaDoc).entities;
      const definitionRanges =
        parseCedarDocEntities(cedarEntitiesDoc).definitions;
      for (let definitionRange of definitionRanges) {
        if (definitionRange.contains(position)) {
          const text = cedarEntitiesDoc.getText(definitionRange);
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
    const schemaRanges = parseCedarDocSchema(schemaDoc).entities;
    const definitionRanges = parseCedarDocSchema(schemaDoc).definitions;
    for (let definitionRange of definitionRanges) {
      if (definitionRange.contains(position)) {
        const text = schemaDoc.getText(definitionRange);
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

    return null;
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
      const schemaRanges = parseCedarDocSchema(schemaDoc).entities;
      const definitionRanges = parseCedarDocPolicies(cedarDoc).definitions;
      for (let definitionRange of definitionRanges) {
        if (definitionRange.contains(position)) {
          const text = cedarDoc.getText(definitionRange);
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
    }

    return null;
  }
}
