// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import { CEDAR_TESTS_GLOB, getCedarTestFiles } from './fileutil';
import { parseCedarTestsDoc } from './parser';
import { CedarTest, parseTestsDocText } from './validate';

/*
 * see https://code.visualstudio.com/api/extension-guides/testing
 */

const CONTROLLER_ID = 'cedar';
const CONTROLLER_LABEL = 'Cedar';

// Cedar files a tests file is evaluated against
export type CedarTestRun = {
  schema: string;
  schemaIsJson: boolean;
  policies: string;
  templateLinks: string;
  entities: string;
};

const testItemId = (uri: vscode.Uri, index: number): string =>
  `${uri.toString()}#${index}`;

export const gatherTestRun = async (
  testsDoc: vscode.TextDocument,
): Promise<CedarTestRun> => {
  const { schemaDoc, policyDocs, templateLinksDoc, entitiesDoc } =
    await getCedarTestFiles(testsDoc);

  return {
    schema: schemaDoc?.getText() || '',
    schemaIsJson: schemaDoc?.languageId !== 'cedarschema',
    policies: policyDocs.map((doc) => doc.getText()).join('\n\n'),
    templateLinks: templateLinksDoc?.getText() || '',
    entities: entitiesDoc?.getText() || '[]',
  };
};

const sorted = (values: string[]): string[] => [...values].sort();

const describeExpected = (test: CedarTest): string => {
  const lines = [`decision: ${test.decision}`];
  if (test.reason !== undefined) {
    lines.push(`reason: ${JSON.stringify(sorted(test.reason))}`);
  }
  if (test.num_errors !== undefined) {
    lines.push(`num_errors: ${test.num_errors}`);
  }
  return lines.join('\n');
};

const describeActual = (
  test: CedarTest,
  decision: string,
  reasons: string[],
  errors: string[],
): string => {
  const lines = [`decision: ${decision}`];
  if (test.reason !== undefined) {
    lines.push(`reason: ${JSON.stringify(sorted(reasons))}`);
  }
  if (test.num_errors !== undefined) {
    lines.push(`num_errors: ${errors.length}`);
  }
  return lines.join('\n');
};

// evaluate a single Cedar test, returning failure messages (empty when passing)
export const evaluateTest = (
  test: CedarTest,
  testRun: CedarTestRun,
): { failures: string[]; expected: string; actual: string } => {
  const entities =
    test.entities !== undefined
      ? JSON.stringify(test.entities)
      : testRun.entities;

  const result = cedar.isAuthorized(
    testRun.schema,
    testRun.schemaIsJson,
    testRun.policies,
    testRun.templateLinks,
    entities,
    JSON.stringify(test.request || {}),
  );

  try {
    if (!result.success) {
      return {
        failures: Array.from(result.errors),
        expected: describeExpected(test),
        actual: 'unable to evaluate request',
      };
    }

    const decision = result.decision as string;
    const reasons: string[] = Array.from(result.reasons);
    const errors: string[] = Array.from(result.errors);
    const failures: string[] = [];

    if (decision !== test.decision) {
      failures.push(`expected ${test.decision} but was ${decision}`);
    }
    if (test.reason !== undefined) {
      const expectedReason = sorted(test.reason).join(',');
      if (sorted(reasons).join(',') !== expectedReason) {
        failures.push(
          `expected reason [${sorted(test.reason).join(
            ', ',
          )}] but was [${sorted(reasons).join(', ')}]`,
        );
      }
    }
    if (test.num_errors !== undefined && errors.length !== test.num_errors) {
      failures.push(
        `expected ${test.num_errors} error(s) but was ${errors.length}`,
      );
    }
    // an omitted "num_errors" is the same as 0, so report every error
    errors.forEach((e) => failures.push(e));

    return {
      failures: failures,
      expected: describeExpected(test),
      actual: describeActual(test, decision, reasons, errors),
    };
  } finally {
    result.free();
  }
};

/**
 * Discover the tests within a Cedar tests file, replacing the children of the
 * file's `vscode.TestItem`.
 */
export const resolveCedarTestItems = async (
  controller: vscode.TestController,
  fileItem: vscode.TestItem,
): Promise<void> => {
  if (!fileItem.uri) {
    return;
  }

  let testsDoc: vscode.TextDocument;
  try {
    testsDoc = await vscode.workspace.openTextDocument(fileItem.uri);
  } catch {
    controller.items.delete(fileItem.id);
    return;
  }

  const testRanges = parseCedarTestsDoc(testsDoc).tests;
  const tests = parseTestsDocText(testsDoc, []);
  const children: vscode.TestItem[] = [];
  (tests || []).forEach((test, index) => {
    const item = controller.createTestItem(
      testItemId(fileItem.uri as vscode.Uri, index),
      test.name || `test${index}`,
      fileItem.uri,
    );
    item.range = testRanges[index]?.range;
    item.sortText = String(index).padStart(6, '0');
    children.push(item);
  });
  fileItem.children.replace(children);
  fileItem.canResolveChildren = true;
};

export const createCedarTestController = (
  context: vscode.ExtensionContext,
): vscode.TestController => {
  const controller = vscode.tests.createTestController(
    CONTROLLER_ID,
    CONTROLLER_LABEL,
  );
  context.subscriptions.push(controller);

  const getOrCreateFileItem = (uri: vscode.Uri): vscode.TestItem => {
    const existing = controller.items.get(uri.toString());
    if (existing) {
      return existing;
    }

    const item = controller.createTestItem(
      uri.toString(),
      vscode.workspace.asRelativePath(uri),
      uri,
    );
    item.canResolveChildren = true;
    controller.items.add(item);

    return item;
  };

  const resolveFileItem = (fileItem: vscode.TestItem) =>
    resolveCedarTestItems(controller, fileItem);

  controller.resolveHandler = async (item) => {
    if (item) {
      await resolveFileItem(item);
    } else {
      const uris = await vscode.workspace.findFiles(
        CEDAR_TESTS_GLOB,
        '**/node_modules/**',
      );
      uris.forEach((uri) => getOrCreateFileItem(uri));
    }
  };

  const runHandler = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ) => {
    const run = controller.createTestRun(request);

    // expand the requested items into leaf (per test) items
    const queue: vscode.TestItem[] = [];
    const enqueue = async (item: vscode.TestItem) => {
      if (request.exclude?.includes(item)) {
        return;
      }
      if (item.canResolveChildren) {
        // a Cedar tests file, which is never run on its own
        if (item.children.size === 0) {
          await resolveFileItem(item);
        }
        for (const [, child] of item.children) {
          await enqueue(child);
        }
        return;
      }
      queue.push(item);
    };

    const roots: vscode.TestItem[] = [];
    if (request.include) {
      roots.push(...request.include);
    } else {
      for (const [, item] of controller.items) {
        roots.push(item);
      }
    }
    for (const root of roots) {
      await enqueue(root);
    }
    queue.forEach((item) => run.enqueued(item));

    // group by Cedar tests file so each file is only read and parsed once
    const byFile = new Map<string, vscode.TestItem[]>();
    queue.forEach((item) => {
      const uri = item.uri?.toString();
      if (uri) {
        byFile.set(uri, [...(byFile.get(uri) || []), item]);
      }
    });

    for (const [uri, items] of byFile) {
      if (token.isCancellationRequested) {
        break;
      }

      let testsDoc: vscode.TextDocument;
      try {
        testsDoc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uri),
        );
      } catch {
        items.forEach((item) =>
          run.errored(item, new vscode.TestMessage(`Cannot open ${uri}`)),
        );
        continue;
      }

      const diagnostics: vscode.Diagnostic[] = [];
      const tests = parseTestsDocText(testsDoc, diagnostics);
      if (!tests) {
        const message = new vscode.TestMessage(
          diagnostics.map((d) => d.message).join('\n') ||
            'Invalid Cedar tests file',
        );
        items.forEach((item) => run.errored(item, message));
        continue;
      }

      const testRun = await gatherTestRun(testsDoc);
      if (testRun.policies.trim().length === 0) {
        const message = new vscode.TestMessage(
          'No Cedar policy (*.cedar) file found alongside this Cedar tests file',
        );
        items.forEach((item) => run.errored(item, message));
        continue;
      }

      const testRanges = parseCedarTestsDoc(testsDoc).tests;
      for (const item of items) {
        if (token.isCancellationRequested) {
          break;
        }

        const index = Number(item.id.substring(item.id.lastIndexOf('#') + 1));
        const test = tests[index];
        if (!test) {
          run.errored(item, new vscode.TestMessage('Cedar test not found'));
          continue;
        }

        run.started(item);
        const start = Date.now();
        const { failures, expected, actual } = evaluateTest(test, testRun);
        const duration = Date.now() - start;

        if (failures.length === 0) {
          run.passed(item, duration);
        } else {
          const message = new vscode.TestMessage(failures.join('\n'));
          message.expectedOutput = expected;
          message.actualOutput = actual;
          if (item.uri && testRanges[index]) {
            message.location = new vscode.Location(
              item.uri,
              testRanges[index].nameRange || testRanges[index].range,
            );
          }
          run.failed(item, message, duration);
        }
      }
    }

    run.end();
  };

  controller.createRunProfile(
    'Run Cedar tests',
    vscode.TestRunProfileKind.Run,
    runHandler,
    true,
  );

  /*
   * keep the test tree in sync with the workspace
   */
  const watcher = vscode.workspace.createFileSystemWatcher(CEDAR_TESTS_GLOB);
  context.subscriptions.push(watcher);
  context.subscriptions.push(
    watcher.onDidCreate((uri) => getOrCreateFileItem(uri)),
  );
  context.subscriptions.push(
    watcher.onDidChange(async (uri) => {
      const item = controller.items.get(uri.toString());
      if (item) {
        await resolveFileItem(item);
      }
    }),
  );
  context.subscriptions.push(
    watcher.onDidDelete((uri) => controller.items.delete(uri.toString())),
  );

  return controller;
};
