// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

/*
 * see https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
 * see https://github.com/microsoft/node-jsonc-parser
 */

const tokenTypes = ['namespace', 'type', 'property', 'macro', 'function'];
const tokenModifiers = ['declaration', 'deprecated'];
export const semanticTokensLegend = new vscode.SemanticTokensLegend(
  tokenTypes,
  tokenModifiers
);

// analyze the Cedar schema JSON documents and return semantic tokens
export const schemaTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarSchemaDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    const tokensBuilder = new vscode.SemanticTokensBuilder(
      semanticTokensLegend
    );

    jsonc.visit(cedarSchemaDoc.getText(), {
      onObjectProperty(
        property,
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
        if (jsonPathLen === 0) {
          tokensBuilder.push(range, 'namespace', ['declaration']);
        } else if (
          // anything directly under "commonTypes", "entityTypes" or "actions" is an type declaration
          jsonPathLen === 2 &&
          (pathSupplier()[1] === 'commonTypes' ||
            pathSupplier()[1] === 'entityTypes' ||
            pathSupplier()[1] === 'actions')
        ) {
          tokensBuilder.push(range, 'type', ['declaration']);
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
        } else if (
          // anything directly under "principalTypes" or "resourceTypes" under "actions" is a type
          jsonPathLen === 6 &&
          pathSupplier()[1] === 'actions' &&
          (pathSupplier()[4] === 'principalTypes' ||
            pathSupplier()[4] === 'resourceTypes')
        ) {
          tokensBuilder.push(range, 'type', []);
        } else if (
          // "id" or "type" under "memberOf" under "actions" is a type
          jsonPathLen === 6 &&
          pathSupplier()[1] === 'actions' &&
          pathSupplier()[3] === 'memberOf' &&
          (pathSupplier()[5] === 'id' || pathSupplier()[5] === 'type')
        ) {
          tokensBuilder.push(range, 'type', []);
        } else if (pathSupplier()[jsonPathLen - 1] === 'name') {
          // anything directly under "name" is (probably) a type
          if (value === 'ipaddr' || value === 'decimal') {
            tokensBuilder.push(range, 'function', []);
          } else {
            tokensBuilder.push(range, 'type', []);
          }
        }
      },
    });

    return tokensBuilder.build();
  },
};

// analyze the Cedar entities JSON documents and return semantic tokens
export const entitiesTokensProvider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    cedarEntitiesDoc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    const tokensBuilder = new vscode.SemanticTokensBuilder(
      semanticTokensLegend
    );

    jsonc.visit(cedarEntitiesDoc.getText(), {
      onObjectProperty(
        property,
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
        if (jsonPathLen === 2 && pathSupplier()[1] === 'attrs') {
          // anything directly under "attrs" is an property
          tokensBuilder.push(range, 'property', []);
        } else if (property === '__expr') {
          // treat "__expr" as a deprecated macro
          tokensBuilder.push(range, 'macro', ['deprecated']);
        } else if (property === '__entity' || property === '__extn') {
          // treat "__entity" and "__extn as a macro
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
        const jsonPathLen = pathSupplier().length;
        const range = new vscode.Range(
          new vscode.Position(startLine, startCharacter),
          new vscode.Position(startLine, startCharacter + length)
        );
        if (
          jsonPathLen > 2 &&
          pathSupplier()[jsonPathLen - 1] === 'type' &&
          (pathSupplier()[1] === 'uid' ||
            pathSupplier()[1] === 'parents' ||
            pathSupplier()[jsonPathLen - 2] === '__entity')
        ) {
          // most things directly under "type" are a type
          tokensBuilder.push(range, 'type', []);
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

    return tokensBuilder.build();
  },
};
