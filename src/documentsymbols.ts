// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import {
  parseCedarEntitiesDoc,
  parseCedarPoliciesDoc,
  parseCedarSchemaDoc,
  parseCedarTemplateLinksDoc,
} from './parser';

export class CedarDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols: vscode.DocumentSymbol[] = [];
      const policyRanges = parseCedarPoliciesDoc(document).policies;
      policyRanges.forEach((policyRange, index) => {
        symbols.push(
          new vscode.DocumentSymbol(
            policyRange.id,
            '',
            vscode.SymbolKind.Function,
            policyRange.range,
            policyRange.effectRange
          )
        );
      });

      return Promise.resolve(symbols);
    } catch (error) {
      return Promise.resolve([]);
    }
  }
}

export class CedarFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    context: vscode.FoldingContext,
    token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const policyRanges = parseCedarPoliciesDoc(document).policies;
    policyRanges.forEach((policyRange, index) => {
      ranges.push(
        new vscode.FoldingRange(
          policyRange.range.start.line,
          policyRange.range.end.line,
          vscode.FoldingRangeKind.Region
        )
      );

      if (policyRange.effectRange.start.line > policyRange.range.start.line) {
        ranges.push(
          new vscode.FoldingRange(
            policyRange.effectRange.start.line,
            policyRange.range.end.line
          )
        );
      }
    });

    return ranges;
  }
}

export class CedarEntitiesDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols: vscode.DocumentSymbol[] = [];

      const entityRanges = parseCedarEntitiesDoc(document).entities;
      entityRanges.forEach((entityRange, index) => {
        const symbol = new vscode.DocumentSymbol(
          entityRange.uid,
          '',
          vscode.SymbolKind.Object,
          entityRange.range,
          entityRange.uidKeyRange
        );
        if (entityRange.attrsRange && entityRange.attrsKeyRange) {
          symbol.children.push(
            new vscode.DocumentSymbol(
              'attrs',
              '',
              vscode.SymbolKind.Object,
              entityRange.attrsRange,
              entityRange.attrsKeyRange
            )
          );
        }
        if (entityRange.parentsRange && entityRange.parentsKeyRange) {
          symbol.children.push(
            new vscode.DocumentSymbol(
              'parents',
              '',
              vscode.SymbolKind.Array,
              entityRange.parentsRange,
              entityRange.parentsKeyRange
            )
          );
        }
        symbols.push(symbol);
      });

      return Promise.resolve(symbols);
    } catch (error) {
      return Promise.resolve([]);
    }
  }
}

export class CedarTemplateLinksDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  async provideDocumentSymbols(
    cedarTemplateLinksDoc: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols: vscode.DocumentSymbol[] = [];

      const templateLinkRanges = parseCedarTemplateLinksDoc(
        cedarTemplateLinksDoc
      ).links;
      templateLinkRanges.forEach((templateLinkRange, index) => {
        symbols.push(
          new vscode.DocumentSymbol(
            templateLinkRange.id,
            '',
            vscode.SymbolKind.Object,
            templateLinkRange.range,
            templateLinkRange.linkIdRange
          )
        );
      });

      return Promise.resolve(symbols);
    } catch (error) {
      return Promise.resolve([]);
    }
  }
}

export class CedarSchemaDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  async provideDocumentSymbols(
    cedarSchemaDoc: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols: vscode.DocumentSymbol[] = [];

      const entityRanges = parseCedarSchemaDoc(cedarSchemaDoc).entities;
      entityRanges.forEach((entityRange, index) => {
        symbols.push(
          new vscode.DocumentSymbol(
            entityRange.etype,
            '',
            entityRange.symbol,
            entityRange.range,
            entityRange.etypeRange
          )
        );
      });

      return Promise.resolve(symbols);
    } catch (error) {
      return Promise.resolve([]);
    }
  }
}
