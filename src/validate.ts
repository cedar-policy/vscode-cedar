// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
import {
  addPolicyResultErrors,
  addSyntaxDiagnosticErrors,
  reportFormatterOff,
} from './diagnostics';
import {
  getSchemaTextDocument,
  detectEntitiesDoc,
  detectSchemaDoc,
} from './fileutil';
import { parseCedarPoliciesDoc } from './parser';

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
    actions: string[]
  ) {
    this.entityTypes[schemaDoc.uri.toString()] = {
      version: schemaDoc.version,
      principals: principals,
      resources: resources,
      actions: actions,
    };
  }

  checkEntityTypes(
    schemaDoc: vscode.TextDocument
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
    doc: vscode.TextDocument
  ) {
    const s = this.docsBySchema[schemaDoc.uri.toString()] || new Set();
    s.add(doc.uri.toString());
    this.docsBySchema[schemaDoc.uri.toString()] = s;
  }

  revalidateSchema(
    schemaDoc: vscode.TextDocument,
    diagnosticCollection: vscode.DiagnosticCollection
  ) {
    const docs = this.docsBySchema[schemaDoc.uri.toString()];
    if (docs) {
      docs.forEach((docUri) => {
        delete this.cache[docUri];
        const textDoc = vscode.workspace.openTextDocument(
          vscode.Uri.parse(docUri)
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
  position: vscode.Position
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
          head
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
  position: vscode.Position
): string[] => {
  const { principals, resources, actions } = fetchEntityTypes(
    schemaDoc,
    cedarDoc,
    position
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
  diagnosticCollection: vscode.DiagnosticCollection
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
  }
};

export const validateCedarDoc = async (
  cedarDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false
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
    cedarDoc.getText()
  );
  let success = syntaxResult.success;
  if (syntaxResult.errors) {
    addSyntaxDiagnosticErrors(diagnostics, syntaxResult.errors, cedarDoc);
  } else {
    const schemaDoc = await getSchemaTextDocument(cedarDoc);
    if (schemaDoc) {
      if (validateSchemaDoc(schemaDoc, diagnosticCollection, userInitiated)) {
        validationCache.associateSchemaWithDoc(schemaDoc, cedarDoc);

        parseCedarPoliciesDoc(cedarDoc, (policyRange, policyText) => {
          const policyResult: cedar.ValidatePolicyResult = cedar.validatePolicy(
            schemaDoc.getText(),
            policyText
          );
          if (policyResult.success === false && policyResult.errors) {
            addPolicyResultErrors(
              diagnostics,
              policyResult.errors,
              policyText,
              policyRange.effectRange,
              policyRange.range.start.line
            );
          }
          policyResult.free();
        });
      }
    }
  }
  diagnosticCollection.set(cedarDoc.uri, diagnostics);
  syntaxResult.free();

  validationCache.store(cedarDoc, success);

  return Promise.resolve(success);
};

export const validateSchemaDoc = (
  schemaDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false
): boolean => {
  if (!userInitiated) {
    const cachedItem = validationCache.check(schemaDoc);
    if (cachedItem) {
      // console.log(`validateSchemaDoc (cached) ${schemaDoc.uri.toString()}`);
      return cachedItem.valid;
    }
  }
  // console.log(`validateSchemaDoc ${schemaDoc.uri.toString()}`);

  const schema = schemaDoc.getText();
  const schemaResult: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
  const success = schemaResult.success;
  if (schemaResult.success === false && schemaResult.errors) {
    let schemaDiagnostics: vscode.Diagnostic[] = [];
    let vse = schemaResult.errors.map((e) => {
      return { message: e, offset: 0, length: 0 };
    });
    addSyntaxDiagnosticErrors(schemaDiagnostics, vse, schemaDoc);
    diagnosticCollection.set(schemaDoc.uri, schemaDiagnostics);
  } else {
    // reset any errors for the schema from a previous validateSchema
    diagnosticCollection.delete(schemaDoc.uri);

    // determine applicable principal and resource types
    const principalTypes = determineEntityTypes(schemaDoc, 'principal');
    const resourceTypes = determineEntityTypes(schemaDoc, 'resource');
    const actionIds = determineEntityTypes(schemaDoc, 'action');
    validationCache.storeEntityTypes(
      schemaDoc,
      principalTypes,
      resourceTypes,
      actionIds
    );

    // revalidate any Cedar files using this schema
    validationCache.revalidateSchema(schemaDoc, diagnosticCollection);
  }
  schemaResult.free();

  validationCache.store(schemaDoc, success);

  return success;
};

// TODO: find a real API to call for determineEntityTypes
// parsing errors from intentionally invalid policy is an ugly hack
const UNEXPECTED_REGEX =
  /Unexpected type. Expected {"type":"Boolean"} but saw {"type":"Entity","name":"(?<suggestion>.+)"}/;
const ATTRIBUTE_REGEX =
  /attribute `__vscode__` in context for (?<suggestion>.+) not found/;
export const determineEntityTypes = (
  schemaDoc: vscode.TextDocument,
  scope: 'principal' | 'resource' | 'action',
  head: string = 'permit (principal, action, resource)'
): string[] => {
  const types: string[] = [];
  const expr = scope === 'action' ? 'context.__vscode__' : scope;
  const tmpPolicy = `${head} when { ${expr} };`;
  let policyResult: cedar.ValidatePolicyResult;
  policyResult = cedar.validatePolicy(schemaDoc.getText(), tmpPolicy);
  if (policyResult.success === false && policyResult.errors) {
    policyResult.errors.forEach((e) => {
      let found =
        scope === 'action'
          ? e.match(ATTRIBUTE_REGEX)
          : e.match(UNEXPECTED_REGEX);

      if (found?.groups && found?.groups.suggestion) {
        types.push(found.groups.suggestion);
      }
    });
  }
  policyResult.free();
  return types.sort();
};

export const validateEntitiesDoc = async (
  entitiesDoc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  userInitiated: boolean = false
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

      const entitiesResult: cedar.ValidateEntitiesResult =
        cedar.validateEntities(entities, schemaDoc.getText());
      success = entitiesResult.success;
      if (entitiesResult.success === false && entitiesResult.errors) {
        let vse = entitiesResult.errors.map((e) => {
          return { message: e, offset: 0, length: 0 };
        });
        addSyntaxDiagnosticErrors(entitiesDiagnostics, vse, entitiesDoc);
      }
      entitiesResult.free();
    }
  } else {
    if (userInitiated) {
      vscode.window.showErrorMessage(
        `Cedar schema file not found or configured in settings.json`
      );
    }
  }

  diagnosticCollection.set(entitiesDoc.uri, entitiesDiagnostics);

  validationCache.store(entitiesDoc, success);

  return Promise.resolve(success);
};
