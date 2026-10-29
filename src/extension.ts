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
  cedarKindGlob,
  determineCedarKind,
  saveTextAndFormat,
} from './fileutil';
import { createDiagnosticCollection } from './diagnostics';
import { formatCedarDoc, formatCedarSchemaDoc } from './format';
import {
  clearValidationCache,
  validateCedarDoc,
  validateEntitiesDoc,
  validateSchemaDoc,
  validateTestsDoc,
  validateTextDocument,
} from './validate';
import { CedarSchemaJSONQuickFix, CedarQuickFix } from './quickfix';
import {
  COMMAND_CEDAR_ABOUT,
  COMMAND_CEDAR_ACTIVATE,
  COMMAND_CEDAR_CLEARPROBLEMS,
  COMMAND_CEDAR_CLIAUTHORIZE,
  COMMAND_CEDAR_CLIENTITIESPARSE,
  COMMAND_CEDAR_CLIRUNTESTS,
  COMMAND_CEDAR_CLISCHEMAPARSE,
  COMMAND_CEDAR_CLIVALIDATE,
  COMMAND_CEDAR_DOCUMENTATION,
  COMMAND_CEDAR_ENTITIESADD,
  COMMAND_CEDAR_ENTITIESVALIDATE,
  COMMAND_CEDAR_EXPORT,
  COMMAND_CEDAR_JSONPREVIEW,
  COMMAND_CEDAR_SCHEMAEXPORT,
  COMMAND_CEDAR_SCHEMAOPEN,
  COMMAND_CEDAR_SCHEMATRANSLATE,
  COMMAND_CEDAR_SCHEMAVALIDATE,
  COMMAND_CEDAR_TESTSADD,
  COMMAND_CEDAR_TESTSVALIDATE,
  COMMAND_CEDAR_VALIDATE,
} from './commands';
import {
  CedarDocumentSymbolProvider,
  CedarEntitiesDocumentSymbolProvider,
  CedarFoldingRangeProvider,
  CedarSchemaDocumentSymbolProvider,
  CedarTemplateLinksDocumentSymbolProvider,
  CedarTestsDocumentSymbolProvider,
} from './documentsymbols';
import {
  CedarDefinitionProvider,
  CedarEntitiesDefinitionProvider,
  CedarAuthDefinitionProvider,
  CedarSchemaDefinitionProvider,
  CedarTemplateLinksDefinitionProvider,
  CedarTestsDefinitionProvider,
  CedarJsonDefinitionProvider,
} from './definition';
import {
  semanticTokensLegend,
  cedarTokensProvider,
  entitiesTokensProvider,
  schemaTokensProvider,
  templateLinksTokensProvider,
  testsTokensProvider,
  authTokensProvider,
  cedarJsonTokensProvider,
} from './parser';
import { createCedarTestController } from './testing';
import { exportCedarDocPolicyById, getPolicyQuickPickItems } from './policy';
import {
  CedarCompletionItemProvider,
  CedarSchemaCompletionItemProvider,
} from './completion';
import { CedarHoverProvider, CedarEntitiesJSONHoverProvider } from './hover';
import { CedarSignatureHelpProvider } from './signaturehelp';
import { aboutExtension, detectCedarCLI } from './about';
import * as cedar from 'vscode-cedar-wasm';
import { ValidateWithSchemaCodeLensProvider } from './codelens';
import {
  PolicyLevelCodeLensProvider,
  PolicyLevelInlayHintsProvider,
} from './level';
import {
  addEntitiesJSON,
  addTestsJSON,
  CedarEntitiesJSONCompletionItemProvider,
  CedarTestsJSONCompletionItemProvider,
} from './completionjson';
import { CedarTextDocumentContentProvider } from './provider';
import { CedarCLICommand, runCedarCLI } from './cli';

/*
 * Menu "when" clauses can't read settings, so the kind of Cedar JSON file in
 * the active editor is published as context keys instead
 */
const updateCedarKindContext = (editor: vscode.TextEditor | undefined) => {
  const kind = editor ? determineCedarKind(editor.document) : undefined;
  const setContext = (key: string, value: boolean) =>
    vscode.commands.executeCommand('setContext', key, value);

  setContext('cedar.schemaJsonFile', kind === 'cedarschema.json');
  setContext('cedar.entitiesFile', kind === 'cedarentities');
  setContext('cedar.avpEntitiesFile', kind === 'avpentities');
  setContext('cedar.testsFile', kind === 'cedartests');
  setContext('cedar.authFile', kind === 'cedarauth');
};

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Cedar extension activated');

  cedar.setPanicHook();

  // the optional Cedar CLI, reported by the "About Cedar extension" command
  void detectCedarCLI().then((cedarCLI) =>
    console.log(cedarCLI ?? 'Cedar CLI not found'),
  );

  let diagnosticCollection = createDiagnosticCollection();
  context.subscriptions.push(diagnosticCollection);

  vscode.window.visibleTextEditors.forEach((editor) => {
    if (editor) {
      validateTextDocument(editor.document, diagnosticCollection);
    }
  });

  /*
   * vscode events
   */

  context.subscriptions.push(
    vscode.languages.registerHoverProvider('cedar', new CedarHoverProvider()),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('cedar', new CedarQuickFix(), {
      providedCodeActionKinds: CedarQuickFix.providedCodeActionKinds,
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'cedar' },
      new CedarDocumentSymbolProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: 'cedar' },
      new CedarFoldingRangeProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'cedar' },
      new CedarDefinitionProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: 'cedar' },
      cedarTokensProvider,
      semanticTokensLegend,
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'cedar' },
      new CedarCompletionItemProvider(),
      '.', // functions
      ':', // entities
      '@', // annotations
      '?', // templates
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      { language: 'cedar' },
      new CedarSignatureHelpProvider(),
      '(', // trigger: opening a function call
      ',', // retrigger: moving to the next argument
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'cedar' },
      new ValidateWithSchemaCodeLensProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'cedar' },
      new PolicyLevelCodeLensProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(
      { language: 'cedar' },
      new PolicyLevelInlayHintsProvider(),
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('cedar.schemaFile')) {
          // no need to await to invoke vscode.window.showErrorMessage
          getSchemaTextDocument();
        }
        if (e.affectsConfiguration('cedar.fileAssociations')) {
          // document selectors only accept a static glob, so the Cedar JSON
          // providers are re-registered when the associations change
          registerCedarJsonProviders();
          updateCedarKindContext(vscode.window.activeTextEditor);
        }
        if (e.affectsConfiguration('cedar.levelValidation')) {
          // levels and their warnings are cached with the validation results
          clearValidationCache();
          vscode.workspace.textDocuments
            .filter((doc) => doc.languageId === 'cedar')
            .forEach((doc) => validateTextDocument(doc, diagnosticCollection));
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) =>
      validateTextDocument(document, diagnosticCollection),
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) =>
      validateTextDocument(document, diagnosticCollection),
    ),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateCedarKindContext(editor);
      if (editor) {
        validateTextDocument(editor.document, diagnosticCollection);
      }
    }),
  );

  // createFileSystemWatcher also, or instead?
  context.subscriptions.push(
    vscode.workspace.onWillDeleteFiles((e) =>
      handleWillDeleteFiles(e, diagnosticCollection),
    ),
  );

  // createFileSystemWatcher also, or instead?
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((e) =>
      handleDidRenameFiles(e, diagnosticCollection),
    ),
  );

  /*
   * vscode commands
   */
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CEDAR_ABOUT, (args: any[]) => {
      aboutExtension(context);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMAND_CEDAR_DOCUMENTATION,
      (args: any[]) => {
        vscode.env.openExternal(
          vscode.Uri.parse('https://docs.cedarpolicy.com/', true),
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_ACTIVATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        // force activation when .json files are opened outside of a workspace
        vscode.commands.executeCommand('setContext', 'cedar.activated', true);
        vscode.window.showInformationMessage('Cedar extension activated');
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_VALIDATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        validateCedarDoc(textEditor.document, diagnosticCollection, true);
      },
    ),
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      CedarTextDocumentContentProvider.scheme,
      new CedarTextDocumentContentProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_JSONPREVIEW,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        if (['cedar', 'cedarschema'].includes(textEditor.document.languageId)) {
          const cedarUri = textEditor.document.uri.with({
            scheme: 'cedar',
            path: textEditor.document.uri.path + '.json',
          });
          let jsonDoc = await vscode.workspace.openTextDocument(cedarUri); // calls back into the provider
          await vscode.window.showTextDocument(jsonDoc, { preview: true });
        }
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_EXPORT,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        const results = await vscode.window.showQuickPick(
          getPolicyQuickPickItems(textEditor.document, textEditor.selection),
          {
            title: 'Export Cedar policy as JSON',
            canPickMany: true,
          },
        );
        if (results) {
          const cedarDoc = textEditor.document;
          await Promise.all(
            results.map(async (result) => {
              const exportFilename = cedarDoc.uri.fsPath.replace(
                /\.cedar$/,
                `(${result.label}).cedar.json`,
              );
              const exportJson = await exportCedarDocPolicyById(
                cedarDoc,
                result.label,
                exportFilename,
              );

              if (!exportJson) {
                vscode.window.showErrorMessage(
                  `Unable to export Cedar policy: ${result.label}`,
                );
              } else if (results.length === 1) {
                vscode.commands.executeCommand(
                  'vscode.open',
                  vscode.Uri.file(exportFilename),
                );
              }
            }),
          );
        }
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAVALIDATE,
      (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        validateSchemaDoc(textEditor.document, diagnosticCollection, true);
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMATRANSLATE,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        const uri = textEditor.document.uri;
        if (uri.scheme !== 'file') {
          vscode.window.showErrorMessage(
            `Cedar schema translate only supported for local files`,
          );
          return;
        }

        if (
          !validateSchemaDoc(textEditor.document, diagnosticCollection, true)
        ) {
          vscode.window.showErrorMessage(
            `Cedar schema translate requires a valid Cedar schema file`,
          );
          return;
        }

        const schemaDoc = textEditor.document;
        let translateResult: cedar.TranslateSchemaResult;
        const schemaText = schemaDoc.getText();
        if (schemaDoc.languageId === 'cedarschema') {
          translateResult = cedar.translateSchemaToJSON(schemaText);
        } else {
          translateResult = cedar.translateSchemaFromJSON(schemaText);
        }
        if (translateResult.success && translateResult.schema) {
          const translateUri = uri.with({
            path:
              schemaDoc.languageId === 'cedarschema'
                ? uri.path + '.json'
                : uri.path.substring(0, uri.path.length - 5),
          });
          saveTextAndFormat(translateUri, translateResult.schema);
        } else {
          vscode.window.showErrorMessage(
            translateResult.error || 'Error translating Cedar Schema',
          );
        }
        translateResult.free();
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAEXPORT,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        const uri = textEditor.document.uri;
        if (uri.scheme !== 'file') {
          vscode.window.showErrorMessage(
            `Cedar schema export only supported for local files`,
          );
          return;
        }

        if (
          !validateSchemaDoc(textEditor.document, diagnosticCollection, true)
        ) {
          vscode.window.showErrorMessage(
            `Cedar schema export requires a valid Cedar schema file`,
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
          },
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
              uri.fsPath.lastIndexOf(path.sep) + 1,
            );
            diagramName = diagramName.substring(0, diagramName.indexOf('.'));

            const dsl = generateDiagram(
              diagramName,
              cedarschema,
              result.label as SchemaExportType,
            );
            vscode.workspace.fs.writeFile(
              saveUri,
              new Uint8Array(Buffer.from(dsl)),
            );
            vscode.commands.executeCommand('vscode.open', saveUri);
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_SCHEMAOPEN,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        const fileUri = await getSchemaUri(textEditor.document);
        if (fileUri) {
          try {
            await vscode.commands.executeCommand('vscode.open', fileUri);
          } catch {
            vscode.window.showErrorMessage(
              `Cannot open Cedar schema file: ${fileUri}`,
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Cedar schema file not found or configured in settings.json`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_ENTITIESVALIDATE,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        validateEntitiesDoc(textEditor.document, diagnosticCollection, true);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      COMMAND_CEDAR_TESTSVALIDATE,
      async (
        textEditor: vscode.TextEditor,
        edit: vscode.TextEditorEdit,
        args: any[],
      ) => {
        validateTestsDoc(textEditor.document, diagnosticCollection, true);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CEDAR_TESTSADD, async () => {
      const textEditor = vscode.window.activeTextEditor;
      if (!textEditor) {
        return;
      }

      await addTestsJSON(textEditor, diagnosticCollection);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CEDAR_ENTITIESADD, async () => {
      const textEditor = vscode.window.activeTextEditor;
      if (!textEditor) {
        return;
      }

      await addEntitiesJSON(textEditor, diagnosticCollection);
    }),
  );

  // the optional Cedar CLI, run in a terminal
  (
    [
      [COMMAND_CEDAR_CLIVALIDATE, 'validate'],
      [COMMAND_CEDAR_CLIRUNTESTS, 'run-tests'],
      [COMMAND_CEDAR_CLISCHEMAPARSE, 'check-parse-schema'],
      [COMMAND_CEDAR_CLIENTITIESPARSE, 'check-parse-entities'],
      [COMMAND_CEDAR_CLIAUTHORIZE, 'authorize'],
    ] as [string, CedarCLICommand][]
  ).forEach(([command, cliCommand]) => {
    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(
        command,
        async (
          textEditor: vscode.TextEditor,
          edit: vscode.TextEditorEdit,
          args: any[],
        ) => {
          await runCedarCLI(context, textEditor.document, cliCommand);
        },
      ),
    );
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CEDAR_CLEARPROBLEMS, () => {
      diagnosticCollection.clear();
      clearValidationCache();
    }),
  );

  // formatter implemented using API
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('cedar', {
      async provideDocumentFormattingEdits(
        cedarDoc: vscode.TextDocument,
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
            cedarDoc.lineAt(cedarDoc.lineCount - 1).range.end,
          );

          return Promise.resolve([
            vscode.TextEdit.replace(policyRange, formattedPolicy),
          ]);
        }

        return Promise.resolve(undefined); // no edits
      },
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('cedarschema', {
      async provideDocumentFormattingEdits(
        schemaDoc: vscode.TextDocument,
      ): Promise<vscode.TextEdit[] | undefined> {
        // don't try and format if syntax doesn't validate
        if (!(await validateSchemaDoc(schemaDoc, diagnosticCollection))) {
          return Promise.resolve(undefined);
        }

        const formattedSchema = formatCedarSchemaDoc(schemaDoc);
        if (formattedSchema) {
          // use replacement Range of full document
          const policyRange = new vscode.Range(
            schemaDoc.lineAt(0).range.start,
            schemaDoc.lineAt(schemaDoc.lineCount - 1).range.end,
          );

          return Promise.resolve([
            vscode.TextEdit.replace(policyRange, formattedSchema),
          ]);
        }

        return Promise.resolve(undefined); // no edits
      },
    }),
  );

  /*
   * Cedar schema (Cedar syntax) file providers
   */
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: 'cedarschema' },
      schemaTokensProvider,
      semanticTokensLegend,
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'cedarschema' },
      new CedarSchemaDocumentSymbolProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'cedarschema' },
      new CedarSchemaDefinitionProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'cedarschema' },
      new CedarSchemaCompletionItemProvider(),
    ),
  );

  // context.subscriptions.push(
  //   vscode.languages.registerCodeLensProvider(
  //     { language: 'cedarschema' },
  //     new TranslateSchemaCodeLensProvider()
  //   )
  // );

  /*
   * Cedar JSON file providers.  A document selector only accepts a static
   * glob, so these are disposed and re-registered when the globs change
   * because of the cedar.fileAssociations setting.
   */
  let jsonDisposables: vscode.Disposable[] = [];
  const registerCedarJsonProviders = () => {
    jsonDisposables.forEach((disposable) => disposable.dispose());
    jsonDisposables = [];
    const push = (disposable: vscode.Disposable) =>
      jsonDisposables.push(disposable);

    /*
     * Cedar schema (JSON) file providers
     */
    const schemaSelector = {
      language: 'json',
      pattern: cedarKindGlob('cedarschema.json'),
    };

    push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: schemaSelector.pattern, scheme: 'file' },
        new CedarSchemaJSONQuickFix(),
        {
          providedCodeActionKinds:
            CedarSchemaJSONQuickFix.providedCodeActionKinds,
        },
      ),
    );

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        schemaSelector,
        schemaTokensProvider,
        semanticTokensLegend,
      ),
    );

    // display uid strings in outline and breadcrumb
    push(
      vscode.languages.registerDocumentSymbolProvider(
        schemaSelector,
        new CedarSchemaDocumentSymbolProvider(),
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        schemaSelector,
        new CedarSchemaDefinitionProvider(),
      ),
    );

    /*
     * Cedar entities (JSON) file providers
     */
    const entitiesSelector = {
      language: 'json',
      pattern: cedarKindGlob(['cedarentities', 'avpentities']),
    };

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        entitiesSelector,
        entitiesTokensProvider,
        semanticTokensLegend,
      ),
    );

    // display uid strings in outline and breadcrumb
    push(
      vscode.languages.registerDocumentSymbolProvider(
        entitiesSelector,
        new CedarEntitiesDocumentSymbolProvider(),
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        entitiesSelector,
        new CedarEntitiesDefinitionProvider(),
      ),
    );

    push(
      vscode.languages.registerCodeLensProvider(
        entitiesSelector,
        new ValidateWithSchemaCodeLensProvider(),
      ),
    );

    // snippets are the Cedar entities format, so not avpentities.json
    push(
      vscode.languages.registerCompletionItemProvider(
        { language: 'json', pattern: cedarKindGlob('cedarentities') },
        new CedarEntitiesJSONCompletionItemProvider(diagnosticCollection),
        '{',
      ),
    );

    push(
      vscode.languages.registerHoverProvider(
        entitiesSelector,
        new CedarEntitiesJSONHoverProvider(),
      ),
    );

    /*
     * Cedar template links (JSON) file providers
     */
    const templateLinksSelector = {
      language: 'json',
      pattern: cedarKindGlob('cedartemplatelinks'),
    };

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        templateLinksSelector,
        templateLinksTokensProvider,
        semanticTokensLegend,
      ),
    );

    // display template link id strings in outline and breadcrumb
    push(
      vscode.languages.registerDocumentSymbolProvider(
        templateLinksSelector,
        new CedarTemplateLinksDocumentSymbolProvider(),
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        templateLinksSelector,
        new CedarTemplateLinksDefinitionProvider(),
      ),
    );

    /*
     * Cedar tests (JSON) file providers
     */
    const testsSelector = {
      language: 'json',
      pattern: cedarKindGlob('cedartests'),
    };

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        testsSelector,
        testsTokensProvider,
        semanticTokensLegend,
      ),
    );

    // display test name strings in outline and breadcrumb
    push(
      vscode.languages.registerDocumentSymbolProvider(
        testsSelector,
        new CedarTestsDocumentSymbolProvider(),
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        testsSelector,
        new CedarTestsDefinitionProvider(),
      ),
    );

    push(
      vscode.languages.registerCodeLensProvider(
        testsSelector,
        new ValidateWithSchemaCodeLensProvider(),
      ),
    );

    push(
      vscode.languages.registerCompletionItemProvider(
        testsSelector,
        new CedarTestsJSONCompletionItemProvider(diagnosticCollection),
        '{',
      ),
    );

    // Cedar tests embed Cedar entities, so reuse the entities hover
    push(
      vscode.languages.registerHoverProvider(
        testsSelector,
        new CedarEntitiesJSONHoverProvider(),
      ),
    );

    /*
     * Cedar authorization request (JSON) file providers
     */
    const authSelector = {
      language: 'json',
      pattern: cedarKindGlob('cedarauth'),
    };

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        authSelector,
        authTokensProvider,
        semanticTokensLegend,
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        authSelector,
        new CedarAuthDefinitionProvider(),
      ),
    );

    /*
     * Cedar (JSON) file providers
     */
    const cedarJsonSelector = {
      language: 'json',
      pattern: cedarKindGlob('cedar.json'),
    };

    push(
      vscode.languages.registerDocumentSemanticTokensProvider(
        cedarJsonSelector,
        cedarJsonTokensProvider,
        semanticTokensLegend,
      ),
    );

    push(
      vscode.languages.registerDefinitionProvider(
        cedarJsonSelector,
        new CedarJsonDefinitionProvider(),
      ),
    );
  };

  registerCedarJsonProviders();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      jsonDisposables.forEach((disposable) => disposable.dispose());
      jsonDisposables = [];
    }),
  );

  createCedarTestController(context);

  updateCedarKindContext(vscode.window.activeTextEditor);
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log('Cedar extension deactivated');
}
