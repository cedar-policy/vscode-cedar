// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import * as jsonc from 'jsonc-parser';
import {
  addPolicyResultMessages,
  addSyntaxDiagnosticErrors,
  addValidationDiagnosticError,
  addValidationDiagnosticWarning,
  DEFAULT_RANGE,
  determineRangeFromOffset,
  reportFormatterOff,
} from './diagnostics';
import {
  getSchemaTextDocument,
  detectEntitiesDoc,
  detectSchemaDoc,
  detectTestsDoc,
} from './fileutil';
import { parseCedarPoliciesDoc, parseCedarTestsDoc, TestRange } from './parser';

type ValidationCacheItem = {
  version: number;
  valid: boolean;
};
type EntityTypesCacheItem = {
  version: number;
  principals: string[];
  resources: string[];
  actions: string[];
};

class ValidationCache {
  docsBySchema: Record<string, Set<string>> = {};
  cache: Record<string, ValidationCacheItem> = {};
  entityTypes: Record<string, EntityTypesCacheItem> = {};
  constructor() {}

  check(doc: vscode.TextDocument): ValidationCacheItem | null {
    const cachedItem = this.cache[doc.uri.toString()];
    if (cachedItem && cachedItem.version === doc.version) {
      return cachedItem;
    }

    return null;
  }

  store(doc: vscode.TextDocument, success: boolean) {
    this.cache[doc.uri.toString()] = {
      version: doc.version,
      valid: success,
    };
  }

  storeEntityTypes(
    schemaDoc: vscode.TextDocument,
    principals: string[],
    resources: string[],
    actions: string[],
  ) {
    this.entityTypes[schemaDoc.uri.toString()] = {
      version: schemaDoc.version,
      principals: principals,
      resources: resources,
      actions: actions,
    };
  }

  checkEntityTypes(
    schemaDoc: vscode.TextDocument,
  ): EntityTypesCacheItem | null {
    const cachedItem = this.entityTypes[schemaDoc.uri.toString()];
    if (cachedItem && cachedItem.version === schemaDoc.version) {
      return cachedItem;
    }

    return null;
  }

  fetchEntityTypes(schemaDoc: vscode.TextDocument): {
    principals: string[];
    resources: string[];
    actions: string[];
  } {
    const cachedItem = this.checkEntityTypes(schemaDoc);
    return cachedItem
      ? {
          principals: cachedItem.principals,
          resources: cachedItem.resources,
          actions: cachedItem.actions,
        }
      : {
          principals: [],
          resources: [],
          actions: [],
        };
  }

  clear() {
    this.cache = {};
    this.docsBySchema = {};
    this.entityTypes = {};
  }

  associateSchemaWithDoc(
    schemaDoc: vscode.TextDocument,
    doc: vscode.TextDocument,
  ) {
    const s = this.docsBySchema[schemaDoc.uri.toString()] || new Set();
    s.add(doc.uri.toString());
    this.docsBySchema[schemaDoc.uri.toString()] = s;
  }

  revalidateSchema(
    schemaDoc: vscode.TextDocument,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    const docs = this.docsBySchema[schemaDoc.uri.toString()];
    if (docs) {
      docs.forEach((docUri) => {
        delete this.cache[docUri];
        const textDoc = vscode.workspace.openTextDocument(
          vscode.Uri.parse(docUri),
        );
        textDoc.then((doc) => {
          validateTextDocument(doc, diagnosticCollection);
        });
      });
    }
  }
}
const HEAD_REGEX = /(?:(permit|forbid)\s*\((.|\n)*?\))(?<!\s*(;|when|unless))/;
export const fetchEntityTypes = (
  schemaDoc: vscode.TextDocument,
  cedarDoc: vscode.TextDocument,
  position: vscode.Position,
): {
  principals: string[];
  resources: string[];
  actions: string[];
} => {
  let head: string | undefined = undefined;
  for (let policy of parseCedarPoliciesDoc(cedarDoc).policies) {
    if (policy.range.contains(position)) {
      if (policy.entityTypes === undefined) {
        const match = cedarDoc.getText(policy.range).match(HEAD_REGEX);
        if (match) {
          head = match[0];
        }
        const principalTypes = determineEntityTypes(
          schemaDoc,
          'principal',
          head,
        );
        const resourceTypes = determineEntityTypes(schemaDoc, 'resource', head);
        const actionIds = determineEntityTypes(schemaDoc, 'action', head);
        policy.entityTypes = {
          principals: principalTypes,
          resources: resourceTypes,
          actions: actionIds,
        };

        return policy.entityTypes;
      } else {
        return policy.entityTypes;
      }
    }
  }

  return validationCache.fetchEntityTypes(schemaDoc);
};
const validationCache = new ValidationCache();
export const clearValidationCache = () => {
  validationCache.clear();
};
export const narrowEntityTypes = (
  schemaDoc: vscode.TextDocument,
  scope: string,
  cedarDoc: vscode.TextDocument,
  position: vscode.Position,
): string[] => {
  const { principals, resources, actions } = fetchEntityTypes(
    schemaDoc,
    cedarDoc,
    position,
  );
  let entities: string[] = [];
  if (scope === 'principal') {
    entities = principals;
  } else if (scope === 'resource') {
    entities = resources;
  } else if (['context', 'action'].includes(scope)) {
    entities = actions;
  } else {
    const pos = scope.lastIndexOf('::');
    entities = [scope.substring(0, pos)];
  }
  return entities;
};

export const validateTextDocument = (
  doc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
) => {
  if (doc.uri.scheme !== 'file') {
    // don't validate vscode-local-history or other non-file URIs
    return;
  }
  if (doc.languageId === 'cedar') {
    validateCedarDoc(doc, diagnosticCollection);
  } else if (detectSchemaDoc(doc)) {
    validateSchemaDoc(doc, diagnosticCollection);
  } else if (detectEntitiesDoc(doc)) {
    validateEntitiesDoc(doc, diagnosticCollection);
  } else if (detectTestsDoc(doc)) {
    validateTestsDoc(doc, diagnosticCollection);
  }
};

export const validateCedarDoc = async (
  cedarDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): Promise<boolean> => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(cedarDoc);
    if (cachedItem) {
      // console.log(`validateCedarDoc (cached) ${cedarDoc.uri.toString()}`);
      return Promise.resolve(cachedItem.valid);
    }
  }

  const diagnostics: vscode.Diagnostic[] = [];
  reportFormatterOff(cedarDoc, diagnostics);
  const syntaxResult: cedar.ValidateSyntaxResult = cedar.validateSyntax(
    cedarDoc.getText(),
  );
  try {
    let success = syntaxResult.success;
    if (syntaxResult.errors) {
      addSyntaxDiagnosticErrors(diagnostics, syntaxResult.errors, cedarDoc);
    } else {
      const schemaDoc = await getSchemaTextDocument(cedarDoc);
      if (schemaDoc) {
        if (validateSchemaDoc(schemaDoc, diagnosticCollection, userInitiated)) {
          validationCache.associateSchemaWithDoc(schemaDoc, cedarDoc);

          parseCedarPoliciesDoc(cedarDoc, (policyRange, policyText) => {
            let policyResult: cedar.ValidatePolicyResult;
            if (schemaDoc.languageId === 'cedarschema') {
              policyResult = cedar.validatePolicySchemaCedar(
                schemaDoc.getText(),
                policyText,
              );
            } else {
              policyResult = cedar.validatePolicySchemaJSON(
                schemaDoc.getText(),
                policyText,
              );
            }
            try {
              if (policyResult.warnings) {
                addPolicyResultMessages(
                  diagnostics,
                  policyResult.warnings,
                  policyText,
                  policyRange.effectRange,
                  policyRange.range.start.line,
                  true,
                );
              }
              if (policyResult.success === false && policyResult.errors) {
                addPolicyResultMessages(
                  diagnostics,
                  policyResult.errors,
                  policyText,
                  policyRange.effectRange,
                  policyRange.range.start.line,
                  false,
                );
              }
            } finally {
              policyResult.free();
            }
          });
        }
      }
    }
    diagnosticCollection.set(cedarDoc.uri, diagnostics);

    validationCache.store(cedarDoc, success);

    return Promise.resolve(success);
  } finally {
    syntaxResult.free();
  }
};

export const validateSchemaDoc = (
  schemaDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): boolean => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(schemaDoc);
    if (cachedItem) {
      // console.log(`validateSchemaDoc (cached) ${schemaDoc.uri.toString()}`);
      return cachedItem.valid;
    }
  }
  // console.log(`validateSchemaDoc ${schemaDoc.uri.toString()}`);

  let schemaResult: cedar.ValidateSchemaResult;
  const schema = schemaDoc.getText();
  if (schemaDoc.languageId === 'cedarschema') {
    schemaResult = cedar.validateSchemaCedar(schema);
  } else {
    schemaResult = cedar.validateSchemaJSON(schema);
  }
  try {
    const success = schemaResult.success;
    if (schemaResult.success === false && schemaResult.errors) {
      let schemaDiagnostics: vscode.Diagnostic[] = [];
      let vse = schemaResult.errors.map((e) => {
        return { message: e.message, offset: e.offset, length: e.length };
      });
      addSyntaxDiagnosticErrors(schemaDiagnostics, vse, schemaDoc);
      diagnosticCollection.set(schemaDoc.uri, schemaDiagnostics);
    } else {
      // reset any errors for the schema from a previous validateSchema
      diagnosticCollection.delete(schemaDoc.uri);

      if (schemaResult.warnings) {
        let schemaDiagnostics: vscode.Diagnostic[] = [];
        schemaResult.warnings.map((w) => {
          const range = determineRangeFromOffset(schemaDoc, w.offset, w.length);
          addValidationDiagnosticWarning(schemaDiagnostics, w.message, range);
        });
        diagnosticCollection.set(schemaDoc.uri, schemaDiagnostics);
      }

      // determine applicable principal and resource types
      const principalTypes = determineEntityTypes(schemaDoc, 'principal');
      const resourceTypes = determineEntityTypes(schemaDoc, 'resource');
      const actionIds = determineEntityTypes(schemaDoc, 'action');
      validationCache.storeEntityTypes(
        schemaDoc,
        principalTypes,
        resourceTypes,
        actionIds,
      );

      // revalidate any Cedar files using this schema
      validationCache.revalidateSchema(schemaDoc, diagnosticCollection);
    }

    validationCache.store(schemaDoc, success);

    return success;
  } finally {
    schemaResult.free();
  }
};

// TODO: find a real API to call for determineEntityTypes
// parsing errors from intentionally invalid policy is an ugly hack
const UNEXPECTED_REGEX =
  /unexpected type: expected Bool but saw (?<suggestion>.+)/;
const ATTRIBUTE_REGEX =
  /attribute `__vscode__` in context for (?<suggestion>.+) not found/;
export const determineEntityTypes = (
  schemaDoc: vscode.TextDocument,
  scope: 'principal' | 'resource' | 'action',
  head: string = 'permit (principal, action, resource)',
): string[] => {
  const types: string[] = [];
  const expr = scope === 'action' ? 'context.__vscode__' : scope;
  const tmpPolicy = `${head} when { ${expr} };`;
  let policyResult: cedar.ValidatePolicyResult;
  if (schemaDoc.languageId === 'cedarschema') {
    policyResult = cedar.validatePolicySchemaCedar(
      schemaDoc.getText(),
      tmpPolicy,
    );
  } else {
    policyResult = cedar.validatePolicySchemaJSON(
      schemaDoc.getText(),
      tmpPolicy,
    );
  }
  try {
    if (policyResult.success === false && policyResult.errors) {
      policyResult.errors.forEach((e) => {
        let found =
          scope === 'action'
            ? e.message.match(ATTRIBUTE_REGEX)
            : e.message.match(UNEXPECTED_REGEX);

        if (found?.groups && found?.groups.suggestion) {
          if (!found.groups.suggestion.startsWith('__cedar::internal::')) {
            types.push(found.groups.suggestion);
          }
        }
      });
    }
  } finally {
    policyResult.free();
  }
  return types.sort();
};

/*
 * Cedar tests
 */

export type CedarTest = {
  name?: string;
  request?: {
    principal?: string;
    action?: string;
    resource?: string;
    context?: object;
  };
  entities?: object[];
  decision?: string;
  reason?: string[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  num_errors?: number;
};

export const DECISIONS = ['allow', 'deny'];

// anchor a diagnostic on the test name when available
const testRangeOrDefault = (
  testRange: TestRange | undefined,
  range: vscode.Range | null | undefined = undefined,
): vscode.Range => {
  if (range) {
    return range;
  }
  if (testRange) {
    return testRange.nameRange || testRange.range;
  }
  return DEFAULT_RANGE;
};

/**
 * Parse a Cedar tests document, reporting JSON and structural problems as
 * diagnostics.  Returns `undefined` when the document cannot be used.
 */
export const parseTestsDocText = (
  testsDoc: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[],
): CedarTest[] | undefined => {
  const jsonErrors: jsonc.ParseError[] = [];
  const parsed = jsonc.parse(testsDoc.getText(), jsonErrors, {
    allowTrailingComma: false,
  });

  if (jsonErrors.length > 0) {
    jsonErrors.forEach((e) => {
      addValidationDiagnosticError(
        diagnostics,
        jsonc.printParseErrorCode(e.error),
        determineRangeFromOffset(testsDoc, e.offset, e.length),
      );
    });
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    addValidationDiagnosticError(
      diagnostics,
      'Cedar tests file must contain an array of tests',
    );
    return undefined;
  }

  const testRanges = parseCedarTestsDoc(testsDoc).tests;
  const tests: CedarTest[] = [];
  parsed.forEach((test: CedarTest, index: number) => {
    const testRange = testRanges[index];
    if (typeof test !== 'object' || test === null || Array.isArray(test)) {
      addValidationDiagnosticError(
        diagnostics,
        'expected a Cedar test object',
        testRangeOrDefault(testRange),
      );
      // keep the returned tests aligned with the parsed ranges
      tests.push({});
      return;
    }

    if (typeof test.name !== 'string' || test.name.length === 0) {
      addValidationDiagnosticWarning(
        diagnostics,
        'Cedar test is missing a "name"',
        testRangeOrDefault(testRange),
      );
    }

    const request = test.request;
    if (typeof request !== 'object' || request === null) {
      addValidationDiagnosticError(
        diagnostics,
        'Cedar test is missing a "request"',
        testRangeOrDefault(testRange),
      );
    } else {
      (['principal', 'action', 'resource'] as const).forEach((scope) => {
        if (typeof request[scope] !== 'string') {
          addValidationDiagnosticError(
            diagnostics,
            `"request" is missing "${scope}"`,
            testRangeOrDefault(testRange, testRange?.requestKeyRange),
          );
        }
      });
    }

    if (!DECISIONS.includes(test.decision as string)) {
      addValidationDiagnosticError(
        diagnostics,
        `"decision" must be ${DECISIONS.map((d) => `"${d}"`).join(' or ')}`,
        testRangeOrDefault(testRange),
      );
    }

    if (test.reason !== undefined) {
      if (
        !Array.isArray(test.reason) ||
        test.reason.some((id) => typeof id !== 'string')
      ) {
        addValidationDiagnosticError(
          diagnostics,
          '"reason" must be an array of policy id strings',
          testRangeOrDefault(testRange),
        );
      }
    }

    if (test.num_errors !== undefined && typeof test.num_errors !== 'number') {
      addValidationDiagnosticError(
        diagnostics,
        '"num_errors" must be a number',
        testRangeOrDefault(testRange),
      );
    }

    if (test.entities !== undefined && !Array.isArray(test.entities)) {
      addValidationDiagnosticError(
        diagnostics,
        '"entities" must be an array of Cedar entities',
        testRangeOrDefault(testRange, testRange?.entitiesKeyRange),
      );
    }

    tests.push(test);
  });

  return tests;
};

export const validateTestsDoc = async (
  testsDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): Promise<boolean> => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(testsDoc);
    if (cachedItem) {
      // console.log(`validateTestsDoc (cached) ${testsDoc.uri.toString()}`);
      return Promise.resolve(cachedItem.valid);
    }
  }
  // console.log(`validateTestsDoc ${testsDoc.uri.toString()}`);

  const testsDiagnostics: vscode.Diagnostic[] = [];
  const tests = parseTestsDocText(testsDoc, testsDiagnostics);
  // warnings (such as a missing test name) don't fail validation
  let success =
    tests !== undefined &&
    !testsDiagnostics.some(
      (d) => d.severity === vscode.DiagnosticSeverity.Error,
    );

  if (tests) {
    const schemaDoc = await getSchemaTextDocument(testsDoc);
    if (schemaDoc) {
      if (validateSchemaDoc(schemaDoc, diagnosticCollection, userInitiated)) {
        validationCache.associateSchemaWithDoc(schemaDoc, testsDoc);

        const testRanges = parseCedarTestsDoc(testsDoc).tests;
        // the same entities are often repeated in every test
        const validated: Record<string, string[]> = {};
        tests.forEach((test, index) => {
          if (!Array.isArray(test.entities)) {
            return;
          }

          const entities = JSON.stringify(test.entities);
          if (validated[entities] === undefined) {
            let entitiesResult: cedar.ValidateEntitiesResult;
            if (schemaDoc.languageId === 'cedarschema') {
              entitiesResult = cedar.validateEntitiesSchemaCedar(
                schemaDoc.getText(),
                entities,
              );
            } else {
              entitiesResult = cedar.validateEntitiesSchemaJSON(
                schemaDoc.getText(),
                entities,
              );
            }
            try {
              validated[entities] = entitiesResult.success
                ? []
                : (entitiesResult.errors || []).map((e) => e.message);
            } finally {
              entitiesResult.free();
            }
          }

          validated[entities].forEach((message) => {
            success = false;
            addValidationDiagnosticError(
              testsDiagnostics,
              message,
              testRangeOrDefault(
                testRanges[index],
                testRanges[index]?.entitiesKeyRange,
              ),
            );
          });
        });
      }
    } else if (userInitiated) {
      vscode.window.showErrorMessage(
        `Cedar schema file not found or configured in settings.json`,
      );
    }
  }

  diagnosticCollection.set(testsDoc.uri, testsDiagnostics);

  validationCache.store(testsDoc, success);

  return Promise.resolve(success);
};

export const validateEntitiesDoc = async (
  entitiesDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): Promise<boolean> => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(entitiesDoc);
    if (cachedItem) {
      // console.log(`validateEntitiesDoc (cached) ${entitiesDoc.uri.toString()}`);
      return Promise.resolve(cachedItem.valid);
    }
  }
  // console.log(`validateEntitiesDoc ${entitiesDoc.uri.toString()}`);

  let success = false;
  let entitiesDiagnostics: vscode.Diagnostic[] = [];

  const entities = entitiesDoc.getText();
  const schemaDoc = await getSchemaTextDocument(entitiesDoc);
  if (schemaDoc) {
    if (validateSchemaDoc(schemaDoc, diagnosticCollection, userInitiated)) {
      validationCache.associateSchemaWithDoc(schemaDoc, entitiesDoc);

      let entitiesResult: cedar.ValidateEntitiesResult;
      if (schemaDoc.languageId === 'cedarschema') {
        entitiesResult = cedar.validateEntitiesSchemaCedar(
          schemaDoc.getText(),
          entities,
        );
      } else {
        entitiesResult = cedar.validateEntitiesSchemaJSON(
          schemaDoc.getText(),
          entities,
        );
      }
      try {
        success = entitiesResult.success;
        if (entitiesResult.success === false && entitiesResult.errors) {
          addSyntaxDiagnosticErrors(
            entitiesDiagnostics,
            entitiesResult.errors,
            entitiesDoc,
          );
        }
      } finally {
        entitiesResult.free();
      }
    }
  } else {
    if (userInitiated) {
      vscode.window.showErrorMessage(
        `Cedar schema file not found or configured in settings.json`,
      );
    }
  }

  diagnosticCollection.set(entitiesDoc.uri, entitiesDiagnostics);

  validationCache.store(entitiesDoc, success);

  return Promise.resolve(success);
};
