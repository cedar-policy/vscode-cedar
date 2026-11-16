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
  CedarSchemaSet,
  getSchemaMemberUris,
  getSchemaSetForSchemaDoc,
  getSchemaTextDocument,
  detectEntitiesDoc,
  detectSchemaDoc,
  detectTestsDoc,
  isCombinedSchemaDoc,
} from './fileutil';
import {
  EntityTypes,
  parseCedarPoliciesDoc,
  PolicyRange,
  parseCedarSchemaDoc,
  parseCedarTestsDoc,
  TestRange,
} from './parser';

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

/*
 * Revalidation of the documents using a Cedar schema outlives the call which
 * triggered it, so a document which can no longer be opened, or a diagnostic
 * collection which has since been disposed, is not an error
 */
const revalidateDoc = async (
  docUri: string,
  diagnosticCollection: vscode.DiagnosticCollection,
): Promise<void> => {
  try {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(docUri),
    );
    await validateTextDocument(doc, diagnosticCollection);
  } catch {
    // the document or the diagnostic collection is gone
  }
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

  // a combined schema is associated through each of its schema files, since
  // editing any of them changes the combined schema
  associateSchemaWithDoc(
    schemaDoc: vscode.TextDocument,
    doc: vscode.TextDocument,
  ) {
    getSchemaMemberUris(schemaDoc).forEach((schemaUri) => {
      const s = this.docsBySchema[schemaUri] || new Set();
      s.add(doc.uri.toString());
      this.docsBySchema[schemaUri] = s;
    });
  }

  revalidateSchema(
    schemaDoc: vscode.TextDocument,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    const docUris = new Set<string>();
    getSchemaMemberUris(schemaDoc).forEach((schemaUri) => {
      this.docsBySchema[schemaUri]?.forEach((docUri) => docUris.add(docUri));
    });
    docUris.forEach((docUri) => {
      delete this.cache[docUri];
      void revalidateDoc(docUri, diagnosticCollection);
    });
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
        policy.entityTypes = determineEntityTypes(schemaDoc, head);

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
  policyLevelsCache = {};
  policyScopesCache = {};
  clearSchemaHandles();
};

/*
 * Level validation (RFC 76), where the level is the minimum entity dereference
 * level each policy validates at, or undefined when a policy dereferences an
 * entity literal, which isn't allowed at any level
 */
export type PolicyLevel = {
  range: vscode.Range;
  effectRange: vscode.Range;
  level: number | undefined;
};
type PolicyLevelsCacheItem = {
  version: number;
  levels: PolicyLevel[];
};
let policyLevelsCache: Record<string, PolicyLevelsCacheItem> = {};
const policyLevelsEmitter = new vscode.EventEmitter<void>();
export const onDidChangePolicyLevels = policyLevelsEmitter.event;

/*
 * The principal types, actions, and resource types each Cedar policy applies
 * to, considering the whole policy (scope and conditions), which is only known
 * after the document validates against a Cedar schema
 */
export type PolicyScope = {
  range: vscode.Range;
  effectRange: vscode.Range;
  entityTypes: EntityTypes;
};
type PolicyScopesCacheItem = {
  version: number;
  scopes: PolicyScope[];
};
let policyScopesCache: Record<string, PolicyScopesCacheItem> = {};
const policyScopesEmitter = new vscode.EventEmitter<void>();
export const onDidChangePolicyScopes = policyScopesEmitter.event;

export const getPolicyScopes = (
  cedarDoc: vscode.TextDocument,
): PolicyScope[] => {
  const cachedItem = policyScopesCache[cedarDoc.uri.toString()];
  return cachedItem && cachedItem.version === cedarDoc.version
    ? cachedItem.scopes
    : [];
};

export type PolicyScopeDisplay = 'codeLens' | 'none';
export const getPolicyScopeDisplay = (
  doc: vscode.TextDocument | undefined = undefined,
): PolicyScopeDisplay =>
  vscode.workspace
    .getConfiguration('cedar', doc?.uri)
    .get<PolicyScopeDisplay>('policyScope.display', 'codeLens');

/*
 * A parsed schema per schema document, so determining the entity types of
 * policies doesn't parse the schema each time.  Keyed by the schema text, as a
 * combined schema's virtual document may change without a new version.
 */
type SchemaHandleCacheItem = {
  text: string;
  handle: cedar.SchemaHandle | undefined;
};
let schemaHandleCache: Record<string, SchemaHandleCacheItem> = {};

export const getSchemaHandle = (
  schemaDoc: vscode.TextDocument,
): cedar.SchemaHandle | undefined => {
  const key = schemaDoc.uri.toString();
  const text = schemaDoc.getText();
  const cachedItem = schemaHandleCache[key];
  if (cachedItem && cachedItem.text === text) {
    return cachedItem.handle;
  }
  cachedItem?.handle?.free();
  const handle =
    schemaDoc.languageId === 'cedarschema'
      ? cedar.SchemaHandle.fromCedar(text)
      : cedar.SchemaHandle.fromJSON(text);
  schemaHandleCache[key] = { text, handle };
  return handle;
};

const clearSchemaHandles = () => {
  Object.values(schemaHandleCache).forEach((item) => item.handle?.free());
  schemaHandleCache = {};
};

const NO_ENTITY_TYPES: EntityTypes = {
  principals: [],
  resources: [],
  actions: [],
};

const toEntityTypes = (result: cedar.RequestEnvsResult): EntityTypes => {
  try {
    return {
      principals: result.principals,
      resources: result.resources,
      actions: result.actions,
    };
  } finally {
    result.free();
  }
};

export const getPolicyLevels = (
  cedarDoc: vscode.TextDocument,
): PolicyLevel[] => {
  const cachedItem = policyLevelsCache[cedarDoc.uri.toString()];
  return cachedItem && cachedItem.version === cedarDoc.version
    ? cachedItem.levels
    : [];
};

export const getMaxLevel = (
  doc: vscode.TextDocument | undefined = undefined,
): number | undefined => {
  const maxLevel = vscode.workspace
    .getConfiguration('cedar', doc?.uri)
    .get<number | null>('levelValidation.maxLevel', null);
  return typeof maxLevel === 'number' && maxLevel >= 0
    ? Math.floor(maxLevel)
    : undefined;
};

export type LevelDisplay = 'codeLens' | 'inlayHint' | 'none';
export const getLevelDisplay = (
  doc: vscode.TextDocument | undefined = undefined,
): LevelDisplay =>
  vscode.workspace
    .getConfiguration('cedar', doc?.uri)
    .get<LevelDisplay>('levelValidation.display', 'inlayHint');
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

export const validateTextDocument = async (
  doc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
): Promise<void> => {
  if (doc.uri.scheme !== 'file') {
    // don't validate vscode-local-history or other non-file URIs
    return;
  }
  if (doc.languageId === 'cedar') {
    await validateCedarDoc(doc, diagnosticCollection);
  } else if (detectSchemaDoc(doc)) {
    await validateSchemaFileDoc(doc, diagnosticCollection);
  } else if (detectEntitiesDoc(doc)) {
    await validateEntitiesDoc(doc, diagnosticCollection);
  } else if (detectTestsDoc(doc)) {
    await validateTestsDoc(doc, diagnosticCollection);
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
  const levels: PolicyLevel[] = [];
  const scopes: PolicyScope[] = [];
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
          const maxLevel = getMaxLevel(cedarDoc);
          const showScopes = getPolicyScopeDisplay(cedarDoc) !== 'none';
          const validPolicies: { policyRange: PolicyRange; text: string }[] =
            [];

          // the schema is parsed once for every policy
          const schemaHandle = getSchemaHandle(schemaDoc);

          parseCedarPoliciesDoc(cedarDoc, (policyRange, policyText) => {
            let policyResult: cedar.ValidatePolicyResult;
            if (schemaHandle) {
              policyResult = schemaHandle.validatePolicy(policyText, maxLevel);
            } else if (schemaDoc.languageId === 'cedarschema') {
              // a schema which doesn't parse reports its error on each policy
              policyResult = cedar.validatePolicySchemaCedar(
                schemaDoc.getText(),
                policyText,
                maxLevel,
              );
            } else {
              policyResult = cedar.validatePolicySchemaJSON(
                schemaDoc.getText(),
                policyText,
                maxLevel,
              );
            }
            try {
              if (policyResult.success) {
                levels.push({
                  range: policyRange.range,
                  effectRange: policyRange.effectRange,
                  level: policyResult.level,
                });
                if (showScopes) {
                  validPolicies.push({ policyRange, text: policyText });
                }
              }
              if (policyResult.levelWarnings) {
                addPolicyResultMessages(
                  diagnostics,
                  policyResult.levelWarnings,
                  policyText,
                  policyRange.effectRange,
                  policyRange.range.start.line,
                  true,
                );
              }
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

          // a policy which validates typechecks in at least one request
          // environment, so its conditions can narrow the entity types
          if (validPolicies.length > 0) {
            const entityTypes = determinePoliciesEntityTypes(
              schemaDoc,
              validPolicies.map((p) => p.text),
            );
            validPolicies.forEach(({ policyRange }, i) => {
              scopes.push({
                range: policyRange.range,
                effectRange: policyRange.effectRange,
                entityTypes: entityTypes[i],
              });
            });
          }
        }
      }
    }
    diagnosticCollection.set(cedarDoc.uri, diagnostics);

    validationCache.store(cedarDoc, success);
    policyLevelsCache[cedarDoc.uri.toString()] = {
      version: cedarDoc.version,
      levels: levels,
    };
    policyLevelsEmitter.fire();
    policyScopesCache[cedarDoc.uri.toString()] = {
      version: cedarDoc.version,
      scopes: scopes,
    };
    policyScopesEmitter.fire();

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
    if (isCombinedSchemaDoc(schemaDoc)) {
      // problems are reported on the schema files by validateSchemaSet
    } else if (schemaResult.success === false && schemaResult.errors) {
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
    }

    if (success) {
      // determine applicable principal and resource types
      const { principals, resources, actions } =
        determineEntityTypes(schemaDoc);
      validationCache.storeEntityTypes(
        schemaDoc,
        principals,
        resources,
        actions,
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

// the declaration of an entity type or action in a schema file
const findDeclarationRange = (
  schemaDoc: vscode.TextDocument,
  name: string,
  external: boolean | undefined = undefined,
): vscode.Range | undefined =>
  parseCedarSchemaDoc(schemaDoc).definitionRanges.find(
    (definition) =>
      definition.etype === name &&
      (external === undefined || !!definition.external === external),
  )?.etypeRange;

/**
 * Validate the schema files of a schema set together, reporting problems
 * combining them on the schema file each problem is located in.
 */
export const validateSchemaSet = (
  set: CedarSchemaSet,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): boolean => {
  const link = set.link;
  if (!link) {
    return set.doc
      ? validateSchemaDoc(set.doc, diagnosticCollection, userInitiated)
      : false;
  }

  const diagnosticsByDoc: vscode.Diagnostic[][] = set.docs.map(() => []);
  const located = (index: number) =>
    index >= 0 && index < set.docs.length ? [index] : set.docs.keys();
  link.errors.forEach((e) => {
    for (const i of located(e.index)) {
      const schemaDoc = set.docs[i];
      if (e.index < 0) {
        // not located, so try the declaration the message names
        const name = e.message.match(/`([^`]+)`/)?.[1];
        const range = name ? findDeclarationRange(schemaDoc, name) : undefined;
        if (
          name &&
          !range &&
          set.docs.some((d) => findDeclarationRange(d, name))
        ) {
          continue;
        }
        addValidationDiagnosticError(
          diagnosticsByDoc[i],
          e.message,
          range || DEFAULT_RANGE,
        );
      } else {
        addSyntaxDiagnosticErrors(diagnosticsByDoc[i], [e], schemaDoc);
      }
    }
  });
  link.warnings.forEach((w) => {
    for (const i of located(w.index)) {
      const schemaDoc = set.docs[i];
      addValidationDiagnosticWarning(
        diagnosticsByDoc[i],
        w.message,
        determineRangeFromOffset(schemaDoc, w.offset, w.length),
      );
    }
  });

  // an external declaration which no schema file in the set defines
  [...link.externalEntityTypes, ...link.externalActions].forEach((name) => {
    set.docs.forEach((schemaDoc, i) => {
      const range = findDeclarationRange(schemaDoc, name, true);
      if (range) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `\`${name}\` is declared \`external\` but not defined by any linked schema, so policies can't be validated`,
          vscode.DiagnosticSeverity.Information,
        );
        diagnostic.source = 'cedar';
        diagnosticsByDoc[i].push(diagnostic);
      }
    });
  });

  set.docs.forEach((schemaDoc, i) => {
    diagnosticCollection.set(schemaDoc.uri, diagnosticsByDoc[i]);
    validationCache.store(schemaDoc, link.success);
  });

  if (set.doc) {
    // determines the applicable principal and resource types, and revalidates
    // any documents using the combined schema
    validateSchemaDoc(set.doc, diagnosticCollection, userInitiated);
  }
  set.docs.forEach((schemaDoc) =>
    validationCache.revalidateSchema(schemaDoc, diagnosticCollection),
  );

  return link.success;
};

/**
 * Validate a Cedar schema file, as part of the schema set it belongs to, else
 * on its own.
 */
export const validateSchemaFileDoc = async (
  schemaDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false,
): Promise<boolean> => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(schemaDoc);
    if (cachedItem) {
      return Promise.resolve(cachedItem.valid);
    }
  }

  const set = await getSchemaSetForSchemaDoc(schemaDoc);
  if (set) {
    return Promise.resolve(
      validateSchemaSet(set, diagnosticCollection, userInitiated),
    );
  }

  return Promise.resolve(
    validateSchemaDoc(schemaDoc, diagnosticCollection, userInitiated),
  );
};

/**
 * The principal types, action ids, and resource types a policy applies to,
 * according to the schema.  Only the policy head (scope) is considered, since
 * the body may be incomplete while editing, and a body which doesn't
 * typecheck excludes every request environment.
 */
export const determineEntityTypes = (
  schemaDoc: vscode.TextDocument,
  head: string = 'permit (principal, action, resource)',
): EntityTypes => {
  const handle = getSchemaHandle(schemaDoc);
  return handle
    ? toEntityTypes(handle.requestEnvs(`${head} when { true };`))
    : NO_ENTITY_TYPES;
};

/**
 * The entity types of each whole policy (scope and conditions), in the same
 * order, determined in one call
 */
export const determinePoliciesEntityTypes = (
  schemaDoc: vscode.TextDocument,
  policyTexts: string[],
): EntityTypes[] => {
  const handle = getSchemaHandle(schemaDoc);
  return handle
    ? handle.requestEnvsBatch(policyTexts).map(toEntityTypes)
    : policyTexts.map(() => NO_ENTITY_TYPES);
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
