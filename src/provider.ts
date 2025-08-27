// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';

class CedarJSONDocumentCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const fileUri = document.uri.with({
      scheme: 'file',
      path: document.uri.path.slice(0, -5),
    });
    let fileName = fileUri.fsPath;
    const workspace = vscode.workspace.getWorkspaceFolder(fileUri);
    if (workspace?.uri) {
      fileName = fileName.substring(workspace.uri.fsPath.length + 1);
    }
    const openCommand: vscode.Command = {
      command: 'vscode.open',
      title: `Open ${fileName}`,
      tooltip: `Open ${fileUri.fsPath}`,
      arguments: [fileUri],
    };

    const codeLens = new vscode.CodeLens(
      new vscode.Range(0, 0, 0, 0),
      openCommand
    );

    return Promise.resolve([codeLens]);
  }
}

class CedarJSONDocument {
  private readonly _uri: vscode.Uri;
  private readonly _emitter: vscode.EventEmitter<vscode.Uri>;

  constructor(uri: vscode.Uri, emitter: vscode.EventEmitter<vscode.Uri>) {
    this._uri = uri;

    // The CedarJSONDocument has access to the event emitter from
    // the containing provider. This allows it to signal changes
    this._emitter = emitter;
  }

  async value(): Promise<string> {
    // trim .json from the end and replace protocol of cedar with file
    const fileUri = this._uri.with({
      scheme: 'file',
      path: this._uri.path.slice(0, -5),
    });
    // get text from fileUri
    const document = await vscode.workspace.openTextDocument(fileUri);

    let exportJson = '';
    if (document.languageId === 'cedar') {
      let exportResult = cedar.exportPolicies(document.getText());
      if (exportResult.success && exportResult.json) {
        exportJson = JSON.stringify(JSON.parse(exportResult.json), null, 2);
      } else {
        exportJson = 'Invalid Cedar policies';
      }
      exportResult.free();
    } else if (document.languageId === 'cedarschema') {
      let translateResult: cedar.TranslateSchemaResult;
      translateResult = cedar.translateSchemaToJSON(document.getText());
      if (translateResult.success && translateResult.schema) {
        exportJson = JSON.stringify(
          JSON.parse(translateResult.schema),
          null,
          2
        );
      } else {
        exportJson = 'Invalid Cedar schema';
      }
    }
    return exportJson;
  }
}

export class CedarTextDocumentContentProvider
  implements vscode.TextDocumentContentProvider
{
  static scheme = 'cedar';

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private _documents = new Map<string, CedarJSONDocument>();
  private _subscriptions: vscode.Disposable;

  constructor() {
    // Listen to the `closeTextDocument`-event which means we must
    // clear the corresponding model object - `CedarJSONDocument`
    this._subscriptions = vscode.Disposable.from(
      vscode.workspace.onDidCloseTextDocument((doc) =>
        this._documents.delete(doc.uri.toString())
      ),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === 'cedar' || doc.languageId === 'cedarschema') {
          const virtualUri = doc.uri.with({
            scheme: CedarTextDocumentContentProvider.scheme,
            path: doc.uri.path + '.json',
          });
          this._onDidChange.fire(virtualUri);
        }
      }),
      vscode.languages.registerCodeLensProvider(
        { scheme: CedarTextDocumentContentProvider.scheme },
        new CedarJSONDocumentCodeLensProvider()
      )
    );
  }

  dispose() {
    this._subscriptions.dispose();
    this._documents.clear();
    this._onDidChange.dispose();
  }

  // Expose an event to signal changes of _virtual_ documents
  // to the editor
  get onDidChange() {
    return this._onDidChange.event;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (uri.path.endsWith('.json')) {
      const doc = new CedarJSONDocument(uri, this._onDidChange);
      return await doc.value();
    }

    return '';
  }
}
