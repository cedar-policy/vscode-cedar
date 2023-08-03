// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import { ExportType, generateDiagram } from './generate';
import { HOVER_HELP_DEFINITIONS } from './help';
import {
  handleWillDeleteFiles,
  handleDidRenameFiles,
  getSchemaTextDocument,
  getSchemaUri,
  CEDAR_SCHEMA_GLOB,
  CEDAR_ENTITIES_GLOB,
  CEDAR_SCHEMA_FILE,
  CEDAR_SCHEMA_FILE_GLOB,
  CEDAR_ENTITIES_FILE_GLOB,
} from './fileutil';
import { createDiagnosticCollection } from './diagnostics';
import { formatCedarDoc } from './format';
import {
  clearValidationCache,
  validateCedarDoc,
  validateEntitiesDoc,
  validateSchemaDoc,
  validateTextDocument,
} from './validate';
import {
  entitiesTokensProvider,
  schemaTokensProvider,
  semanticTokensLegend,
} from './semantictokens';
import {
  UndeclaredCommonTypeQuickFix,
  UnrecognizedCedarQuickFix,
} from './quickfix';
import {
  COMMAND_CEDAR_CLEARPROBLEMS,
  COMMAND_CEDAR_ENTITIESVALIDATE,
  COMMAND_CEDAR_SCHEMAEXPORT,
  COMMAND_CEDAR_SCHEMAOPEN,
  COMMAND_CEDAR_SCHEMAVALIDATE,
  COMMAND_CEDAR_VALIDATE,
} from './commands';
import {
  CedarDocumentSymbolProvider,
  CedarEntitiesDocumentSymbolProvider,
  CedarFoldingRangeProvider,
  CedarSchemaDocumentSymbolProvider,
} from './documentsymbols';

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Cedar extension activated');

  let diagnosticCollection = createDiagnosticCollection();

  vscode.window.visibleTextEditors.forEach((editor) => {
    if (editor) {
      validateTextDocument(editor.document, diagnosticCollection);
    }
  });

  /*
   * vscode events
   */

  context.subscriptions.push(
    vscode.languages.registerHoverProvider('cedar', {
      provideHover(document, position, token) {
        const word = document.getText(
          document.getWordRangeAtPosition(position)
        );

        if (HOVER_HELP_DEFINITIONS[word]) {
          return {
            contents: HOVER_HELP_DEFINITIONS[word],
          };
        }
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      'cedar',
      new UnrecognizedCedarQuickFix(),
      {
        providedCodeActionKinds:
          UnrecognizedCedarQuickFix.providedCodeActionKinds,
      }
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'cedar' },
      new CedarDocumentSymbolProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: 'cedar' },
      new CedarFoldingRangeProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: CEDAR_SCHEMA_GLOB, scheme: 'file' },
      new UndeclaredCommonTypeQuickFix(),
      {
        providedCodeActionKinds:
          UndeclaredCommonTypeQuickFix.providedCodeActionKinds,
      }
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      CEDAR_SCHEMA_FILE,
      new UndeclaredCommonTypeQuickFix(),
      {
        providedCodeActionKinds:
          UndeclaredCommonTypeQuickFix.providedCodeActionKinds,
      }
    )
  );

  // context.subscriptions.push(
  //   vscode.languages.registerTypeDefinitionProvider(
  //     { pattern: CEDAR_SCHEMA_GLOB, scheme: "file" },
  //     {
  //       provideTypeDefinition: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
  //         return null;
  //       },
  //     }
  //   )
  // );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('cedar.schemaFile')) {
          // no need to await to invoke vscode.window.showErrorMessage
          getSchemaTextDocument();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) =>
      validateTextDocument(document, diagnosticCollection)
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) =>
      validateTextDocument(document, diagnosticCollection)
    )
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        validateTextDocument(editor.document, diagnosticCollection);
      }
    })
  );

  // createFileSystemWatcher also, or instead?
  context.subscriptions.push(
    vscode.workspace.onWillDeleteFiles((e) =>
      handleWillDeleteFiles(e, diagnosticCollection)
    )
  );

  // createFileSystemWatcher also, or instead?
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((e) =>
      handleDidRenameFiles(e, diagnosticCollection)
    )
  );

  /*
   * vscode commands
   */

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_VALIDATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        validateCedarDoc(textEditor.document, diagnosticCollection, true);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAVALIDATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        validateSchemaDoc(textEditor.document, diagnosticCollection, true);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAEXPORT,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        const uri = textEditor.document.uri;
        if (uri.scheme !== 'file') {
          vscode.window.showErrorMessage(
            `Cedar schema export only supported for local files`
          );
          return;
        }

        if (
          !validateSchemaDoc(textEditor.document, diagnosticCollection, true)
        ) {
          vscode.window.showErrorMessage(
            `Cedar schema export requires a valid Cedar schema file`
          );
          return;
        }

        const result = await vscode.window.showQuickPick([
          ExportType.PlantUML,
          ExportType.Mermaid,
        ]);
        if (result) {
          const cedarschema = JSON.parse(textEditor.document.getText());
          const exportFilename =
            uri.fsPath + (result === ExportType.PlantUML ? '.puml' : '.mmd');
          let diagramName = uri.fsPath.substring(
            uri.fsPath.lastIndexOf(path.sep) + 1
          );
          diagramName = diagramName.substring(0, diagramName.indexOf('.'));

          const dsl = generateDiagram(
            diagramName,
            cedarschema,
            result as ExportType
          );
          vscode.workspace.fs.writeFile(
            vscode.Uri.file(exportFilename),
            new Uint8Array(Buffer.from(dsl))
          );
          vscode.commands.executeCommand(
            'vscode.open',
            vscode.Uri.file(exportFilename)
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAOPEN,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        const fileUri = await getSchemaUri(undefined, textEditor.document);
        if (fileUri) {
          try {
            await vscode.commands.executeCommand('vscode.open', fileUri);
          } catch {
            vscode.window.showErrorMessage(
              `Cannot open Cedar schema file: ${fileUri}`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Cedar schema file not found or configured in settings.json`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_ENTITIESVALIDATE,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        validateEntitiesDoc(textEditor.document, diagnosticCollection, true);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CEDAR_CLEARPROBLEMS, () => {
      diagnosticCollection.clear();
      clearValidationCache();
    })
  );

  // formatter implemented using API
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('cedar', {
      async provideDocumentFormattingEdits(
        cedarDoc: vscode.TextDocument
      ): Promise<vscode.TextEdit[] | undefined> {
        // don't try and format if syntax doesn't validate
        if (!(await validateCedarDoc(cedarDoc, diagnosticCollection))) {
          return Promise.resolve(undefined);
        }

        const formattedPolicy = formatCedarDoc(cedarDoc);
        if (formattedPolicy) {
          // use replacement Range of full document
          const policyRange = new vscode.Range(
            cedarDoc.lineAt(0).range.start,
            cedarDoc.lineAt(cedarDoc.lineCount - 1).range.end
          );

          return Promise.resolve([
            vscode.TextEdit.replace(policyRange, formattedPolicy),
          ]);
        }

        return Promise.resolve(undefined); // no edits
      },
    })
  );

  if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
  ) {
    // @ts-ignore
    const schemaPattern: vscode.RelativePattern = {
      baseUri: vscode.workspace.workspaceFolders[0].uri,
      pattern: CEDAR_SCHEMA_GLOB,
    };
    const schemaSelector = { pattern: schemaPattern, scheme: 'file' };

    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        schemaSelector,
        schemaTokensProvider,
        semanticTokensLegend
      )
    );

    const schemaFileSelector = {
      language: 'json',
      pattern: CEDAR_SCHEMA_FILE_GLOB,
    };
    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        schemaFileSelector,
        schemaTokensProvider,
        semanticTokensLegend
      )
    );

    // display uid strings in outline and breadcrumb
    const schemaSymbolProvider = new CedarSchemaDocumentSymbolProvider();
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(
        schemaSelector,
        schemaSymbolProvider
      )
    );
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(
        schemaFileSelector,
        schemaSymbolProvider
      )
    );

    // @ts-ignore
    const entitiesPattern: vscode.RelativePattern = {
      baseUri: vscode.workspace.workspaceFolders[0].uri,
      pattern: CEDAR_ENTITIES_GLOB,
    };
    const entitiesSelector = { pattern: entitiesPattern, scheme: 'file' };

    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        entitiesSelector,
        entitiesTokensProvider,
        semanticTokensLegend
      )
    );

    const entitiesFileSelector = {
      language: 'json',
      pattern: CEDAR_ENTITIES_FILE_GLOB,
    };
    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        entitiesFileSelector,
        entitiesTokensProvider,
        semanticTokensLegend
      )
    );

    // display uid strings in outline and breadcrumb
    const entitiesSymbolProvider = new CedarEntitiesDocumentSymbolProvider();
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(
        entitiesSelector,
        entitiesSymbolProvider
      )
    );
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(
        entitiesFileSelector,
        entitiesSymbolProvider
      )
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log('Cedar extension deactivated');
}
