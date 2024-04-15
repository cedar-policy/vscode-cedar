// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  SchemaExportType,
  generateDiagram,
  schemaExportTypeExtension,
} from './generate';
import {
  handleWillDeleteFiles,
  handleDidRenameFiles,
  getSchemaTextDocument,
  getSchemaUri,
  CEDAR_SCHEMA_GLOB,
  CEDAR_ENTITIES_GLOB,
  CEDAR_TEMPLATELINKS_GLOB,
  CEDAR_AUTH_GLOB,
  CEDAR_JSON_GLOB,
} from './fileutil';
import { createDiagnosticCollection } from './diagnostics';
import {
  fixCedarSchemaNaturalText,
  fixCedarSchemaText,
  formatCedarDoc,
  formatCedarSchemaNaturalDoc,
} from './format';
import {
  clearValidationCache,
  validateCedarDoc,
  validateEntitiesDoc,
  validateSchemaDoc,
  validateTextDocument,
} from './validate';
import { CedarSchemaJSONQuickFix, CedarQuickFix } from './quickfix';
import {
  COMMAND_CEDAR_ABOUT,
  COMMAND_CEDAR_ACTIVATE,
  COMMAND_CEDAR_CLEARPROBLEMS,
  COMMAND_CEDAR_ENTITIESVALIDATE,
  COMMAND_CEDAR_EXPORT,
  COMMAND_CEDAR_SCHEMAEXPORT,
  COMMAND_CEDAR_SCHEMAOPEN,
  COMMAND_CEDAR_SCHEMATRANSLATE,
  COMMAND_CEDAR_SCHEMAVALIDATE,
  COMMAND_CEDAR_VALIDATE,
} from './commands';
import {
  CedarDocumentSymbolProvider,
  CedarEntitiesDocumentSymbolProvider,
  CedarFoldingRangeProvider,
  CedarSchemaDocumentSymbolProvider,
  CedarTemplateLinksDocumentSymbolProvider,
} from './documentsymbols';
import {
  CedarDefinitionProvider,
  CedarEntitiesDefinitionProvider,
  CedarAuthDefinitionProvider,
  CedarSchemaDefinitionProvider,
  CedarTemplateLinksDefinitionProvider,
  CedarJsonDefinitionProvider,
} from './definition';
import {
  semanticTokensLegend,
  cedarTokensProvider,
  entitiesTokensProvider,
  schemaTokensProvider,
  templateLinksTokensProvider,
  authTokensProvider,
  cedarJsonTokensProvider,
} from './parser';
import { exportCedarDocPolicyById, getPolicyQuickPickItems } from './policy';
import { CedarCompletionItemProvider } from './completion';
import { CedarHoverProvider } from './hover';
import { aboutExtension } from './about';
import * as cedar from 'vscode-cedar-wasm';
import { ValidateWithSchemaCodeLensProvider } from './codelens';

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Cedar extension activated');

  cedar.setPanicHook();

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
    vscode.languages.registerHoverProvider('cedar', new CedarHoverProvider())
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('cedar', new CedarQuickFix(), {
      providedCodeActionKinds: CedarQuickFix.providedCodeActionKinds,
    })
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
    vscode.languages.registerDefinitionProvider(
      { language: 'cedar' },
      new CedarDefinitionProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: 'cedar' },
      cedarTokensProvider,
      semanticTokensLegend
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'cedar' },
      new CedarCompletionItemProvider(),
      '.', // functions
      ':', // entities
      '@', // annotations
      '?' // templates
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'cedar' },
      new ValidateWithSchemaCodeLensProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: CEDAR_SCHEMA_GLOB, scheme: 'file' },
      new CedarSchemaJSONQuickFix(),
      {
        providedCodeActionKinds:
          CedarSchemaJSONQuickFix.providedCodeActionKinds,
      }
    )
  );

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
    vscode.commands.registerCommand(COMMAND_CEDAR_ABOUT, (args: any[]) => {
      aboutExtension();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_ACTIVATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        // force activation when .json files are opened outside of a workspace
        vscode.commands.executeCommand('setContext', 'cedar.activated', true);
        vscode.window.showInformationMessage('Cedar extension activated');
      }
    )
  );
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
      COMMAND_CEDAR_EXPORT,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        const results = await vscode.window.showQuickPick(
          getPolicyQuickPickItems(textEditor.document, textEditor.selection),
          {
            title: 'Export Cedar policy as JSON',
            canPickMany: true,
          }
        );
        if (results) {
          const cedarDoc = textEditor.document;
          results.forEach(async (result) => {
            const exportFilename = cedarDoc.uri.fsPath.replace(
              /\.cedar$/,
              `(${result.label}).cedar.json`
            );
            const exportJson = await exportCedarDocPolicyById(
              cedarDoc,
              result.label,
              exportFilename
            );

            if (!exportJson) {
              vscode.window.showErrorMessage(
                `Unable to export Cedar policy: ${result.label}`
              );
            } else if (results.length === 1) {
              vscode.commands.executeCommand(
                'vscode.open',
                vscode.Uri.file(exportFilename)
              );
            }
          });
        }
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
      COMMAND_CEDAR_SCHEMATRANSLATE,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[]
      ) => {
        const uri = textEditor.document.uri;
        if (uri.scheme !== 'file') {
          vscode.window.showErrorMessage(
            `Cedar schema translate only supported for local files`
          );
          return;
        }

        if (
          !validateSchemaDoc(textEditor.document, diagnosticCollection, true)
        ) {
          vscode.window.showErrorMessage(
            `Cedar schema translate requires a valid Cedar schema file`
          );
          return;
        }

        const schemaDoc = textEditor.document;
        let translateResult: cedar.TranslateSchemaResult;
        const schema = schemaDoc.getText();
        if (schemaDoc.languageId === 'cedarschema') {
          translateResult = cedar.translateSchemaToJSON(schema);
        } else {
          translateResult = cedar.translateSchemaToHuman(schema);
        }
        if (translateResult.success) {
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: uri.with({
              path:
                schemaDoc.languageId === 'cedarschema'
                  ? uri.path + '.json'
                  : uri.path.substring(0, uri.path.length - 5),
            }),
          });
          if (saveUri) {
            let schemaText = translateResult.schema || '';
            if (schemaDoc.languageId === 'cedarschema') {
              schemaText = fixCedarSchemaText(translateResult.schema as string);
            } else {
              schemaText = fixCedarSchemaNaturalText(
                translateResult.schema as string
              );
            }
            vscode.workspace.fs.writeFile(
              saveUri,
              new Uint8Array(Buffer.from(schemaText))
            );
            vscode.commands.executeCommand('vscode.open', saveUri);
          }
        } else {
          vscode.window.showErrorMessage(
            translateResult.error || 'Error translating Cedar Schema'
          );
        }
        translateResult.free();
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

        const result = await vscode.window.showQuickPick(
          [
            {
              label: SchemaExportType.PlantUML,
              description: 'Class Diagram',
            },
            {
              label: SchemaExportType.Mermaid,
              description: 'Class Diagram',
            },
          ],
          {
            title: 'Export Cedar schema (experimental)',
          }
        );
        if (result) {
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: uri.with({
              path: uri.path + schemaExportTypeExtension[result.label],
            }),
          });
          if (saveUri) {
            const cedarschema = JSON.parse(textEditor.document.getText());
            let diagramName = uri.fsPath.substring(
              uri.fsPath.lastIndexOf(path.sep) + 1
            );
            diagramName = diagramName.substring(0, diagramName.indexOf('.'));

            const dsl = generateDiagram(
              diagramName,
              cedarschema,
              result.label as SchemaExportType
            );
            vscode.workspace.fs.writeFile(
              saveUri,
              new Uint8Array(Buffer.from(dsl))
            );
            vscode.commands.executeCommand('vscode.open', saveUri);
          }
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
        const fileUri = await getSchemaUri(textEditor.document);
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
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('cedarschema', {
      async provideDocumentFormattingEdits(
        schemaDoc: vscode.TextDocument
      ): Promise<vscode.TextEdit[] | undefined> {
        // don't try and format if syntax doesn't validate
        if (!(await validateSchemaDoc(schemaDoc, diagnosticCollection))) {
          return Promise.resolve(undefined);
        }

        const formattedSchema = formatCedarSchemaNaturalDoc(schemaDoc);
        if (formattedSchema) {
          // use replacement Range of full document
          const policyRange = new vscode.Range(
            schemaDoc.lineAt(0).range.start,
            schemaDoc.lineAt(schemaDoc.lineCount - 1).range.end
          );

          return Promise.resolve([
            vscode.TextEdit.replace(policyRange, formattedSchema),
          ]);
        }

        return Promise.resolve(undefined); // no edits
      },
    })
  );

  /*
   * Cedar schema (JSON) file providers
   */
  const schemaSelector = {
    language: 'json',
    pattern: CEDAR_SCHEMA_GLOB,
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      schemaSelector,
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
      { language: 'cedarschema' },
      schemaSymbolProvider
    )
  );

  const schemaDefinitionProvider = new CedarSchemaDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      schemaSelector,
      schemaDefinitionProvider
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'cedarschema' },
      schemaDefinitionProvider
    )
  );

  /*
   * Cedar entities (JSON) file providers
   */
  const entitiesSelector = {
    language: 'json',
    pattern: CEDAR_ENTITIES_GLOB,
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      entitiesSelector,
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

  const entitiesDefinitionProvider = new CedarEntitiesDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      entitiesSelector,
      entitiesDefinitionProvider
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      entitiesSelector,
      new ValidateWithSchemaCodeLensProvider()
    )
  );

  /*
   * Cedar template links (JSON) file providers
   */
  const templateLinksSelector = {
    language: 'json',
    pattern: CEDAR_TEMPLATELINKS_GLOB,
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      templateLinksSelector,
      templateLinksTokensProvider,
      semanticTokensLegend
    )
  );

  // display template link id strings in outline and breadcrumb
  const templateLinksSymbolProvider =
    new CedarTemplateLinksDocumentSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      templateLinksSelector,
      templateLinksSymbolProvider
    )
  );

  const templateLinksDefinitionProvider =
    new CedarTemplateLinksDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      templateLinksSelector,
      templateLinksDefinitionProvider
    )
  );

  /*
   * Cedar authorization request (JSON) file providers
   */
  const authSelector = {
    language: 'json',
    pattern: CEDAR_AUTH_GLOB,
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      authSelector,
      authTokensProvider,
      semanticTokensLegend
    )
  );

  const authDefinitionProvider = new CedarAuthDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      authSelector,
      authDefinitionProvider
    )
  );

  /*
   * Cedar (JSON) file providers
   */
  const cedarJsonSelector = {
    language: 'json',
    pattern: CEDAR_JSON_GLOB,
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      cedarJsonSelector,
      cedarJsonTokensProvider,
      semanticTokensLegend
    )
  );

  const cedarJsonDefinitionProvider = new CedarJsonDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      cedarJsonSelector,
      cedarJsonDefinitionProvider
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log('Cedar extension deactivated');
}
