// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { parseCedarDocEntities } from './parser';
const SOURCE_CEDAR = 'Cedar';
export const DEFAULT_RANGE = new vscode.Range(
  new vscode.Position(0, 0),
  new vscode.Position(0, 0)
);
import {
  EXIST_ATTR_REGEX,
  EXPECTED_ATTR_REGEX,
  MISMATCH_ATTR_REGEX,
  OFFSET_POLICY_REGEX,
  FOUND_AT_REGEX,
  AT_LINE_SCHEMA_REGEX,
  UNDECLARED_REGEX,
  UNRECOGNIZED_REGEX,
  EXPECTED_ATTR2_REGEX,
  NOTDECLARED_TYPE_REGEX,
  NOTALLOWED_PARENT_REGEX,
} from './regex';

export const createDiagnosticCollection = () => {
  return vscode.languages.createDiagnosticCollection(SOURCE_CEDAR);
};

const addDiagnosticsError = (
  diagnostics: vscode.Diagnostic[],
  range: vscode.Range,
  message: string,
  code?: string
) => {
  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error
  );
  if (code) {
    diagnostic.code = code;
  }
  diagnostic.source = SOURCE_CEDAR;
  diagnostics.push(diagnostic);
};

const parseRangeFromPolicyError = (
  e: string,
  policy: string,
  defaultErrorRange: vscode.Range,
  startLine: number
): vscode.Range => {
  let range = defaultErrorRange;
  let found = e.match(OFFSET_POLICY_REGEX);
  if (found?.groups) {
    const startCharacter = parseInt(found?.groups.start);
    const endCharacter = parseInt(found?.groups.end) || startCharacter;
    const lines = policy.split('\n');
    let lineStart = 0;
    // not efficient, but Cedar policies are small
    for (let i = 0; i < lines.length; i++) {
      const lineEnd = lines[i].length;
      if (
        lineStart + 1 <= startCharacter &&
        lineStart + 1 + lineEnd >= endCharacter
      ) {
        range = new vscode.Range(
          new vscode.Position(startLine + i, startCharacter - lineStart),
          new vscode.Position(startLine + i, endCharacter - lineStart)
        );
        break;
      }
      lineStart += lineEnd + 1;
    }
  }
  return range;
};

const parseRangeFromError = (
  e: string,
  document: vscode.TextDocument
): vscode.Range => {
  let range = DEFAULT_RANGE;
  let found = e.match(FOUND_AT_REGEX);
  if (found?.groups) {
    const startCharacter = parseInt(found?.groups.start);
    const endCharacter = parseInt(found?.groups.end) || startCharacter;
    let lineStart = 0;
    // not efficient, but Cedar policies are small
    for (let i = 0; i < document.lineCount; i++) {
      const lineEnd = document.lineAt(i).text.length;
      if (
        lineStart + 1 <= startCharacter &&
        lineStart + 1 + lineEnd >= endCharacter
      ) {
        range = new vscode.Range(
          new vscode.Position(i, startCharacter - lineStart),
          new vscode.Position(i, endCharacter - lineStart)
        );
        break;
      }
      lineStart += lineEnd + 1;
    }
  } else {
    const found2 = e.match(AT_LINE_SCHEMA_REGEX);
    if (found2?.groups) {
      const line = parseInt(found2?.groups.line);
      const column = parseInt(found2?.groups.column);
      if (line && column) {
        range = new vscode.Range(
          new vscode.Position(line - 1, column - 1),
          new vscode.Position(line - 1, column - 1)
        );
      }
    }
  }
  return range;
};

const addUndeclaredDiagnosticErrors = (
  diagnostics: vscode.Diagnostic[],
  document: vscode.TextDocument,
  found: RegExpMatchArray
) => {
  const undeclaredTypes = found.groups?.undeclared.split(', ');
  const undeclaredType = found.groups?.type;

  let namespace = '';

  jsonc.visit(document.getText(), {
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      if (pathSupplier().length === 0) {
        namespace = property + '::';
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
        new vscode.Position(startLine, startCharacter + 1),
        new vscode.Position(startLine, startCharacter + length - 1)
      );
      if (
        (jsonPathLen === 5 &&
          pathSupplier()[1] === 'entityTypes' &&
          pathSupplier()[3] === 'memberOfTypes') ||
        (jsonPathLen === 6 &&
          pathSupplier()[1] === 'actions' &&
          (pathSupplier()[4] === 'principalTypes' ||
            pathSupplier()[4] === 'resourceTypes')) ||
        pathSupplier()[jsonPathLen - 1] === 'name'
      ) {
        if (undeclaredType === 'entity') {
          for (let t in undeclaredTypes) {
            const currentType = `"${namespace}${value}"`;
            if (
              // @ts-ignore
              undeclaredTypes[t] === currentType ||
              // @ts-ignore
              undeclaredTypes[t] === `"${value}"`
            ) {
              addDiagnosticsError(
                diagnostics,
                range,
                `Undeclared entity type: ${value}`
              );
            }
          }
        }
      } else if (
        undeclaredType === undefined &&
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        pathSupplier()[3] === 'memberOf' &&
        pathSupplier()[5] === 'id'
      ) {
        for (let t in undeclaredTypes) {
          const currentType = `"${namespace}Action::\\"${value}\\""`;
          // @ts-ignore
          if (undeclaredTypes[t] === currentType) {
            addDiagnosticsError(
              diagnostics,
              range,
              `Undeclared action: ${value}`
            );
          }
        }
      } else if (
        undeclaredType === 'common' &&
        pathSupplier()[jsonPathLen - 1] === 'type'
      ) {
        for (let t in undeclaredTypes) {
          const currentType = `"${value}"`;
          // @ts-ignore
          if (undeclaredTypes[t] === currentType) {
            addDiagnosticsError(
              diagnostics,
              range,
              `Undeclared common type: ${value}`,
              'undeclared'
            );
          }
        }
      }
    },
  });
};

const handleEntitiesDiagnosticError = (
  diagnostics: vscode.Diagnostic[],
  document: vscode.TextDocument,
  error: string
): boolean => {
  let uid = '';
  let attribute = '';
  let uidTypeError = false;
  let parentsError = false;
  let found = error.match(MISMATCH_ATTR_REGEX);
  if (found?.groups) {
    uid = `${found.groups.type}::"${found.groups.id}"`;
    attribute = found.groups.attribute;
  } else {
    found = error.match(EXIST_ATTR_REGEX);
    if (found?.groups) {
      uid = `${found.groups.type}::"${found.groups.id}"`;
      attribute = found.groups.attribute;
    } else {
      found = error.match(EXPECTED_ATTR_REGEX);
      if (found?.groups) {
        uid = `${found.groups.type}::"${found.groups.id}"`;
      } else {
        found = error.match(EXPECTED_ATTR2_REGEX);
        if (found?.groups) {
          uid = `${found.groups.type}::"${found.groups.id}"`;
          attribute = found.groups.attribute;
        } else {
          found = error.match(NOTDECLARED_TYPE_REGEX);
          if (found?.groups) {
            uid = `${found.groups.type}::"${found.groups.id}"`;
            uidTypeError = true;
          } else {
            found = error.match(NOTALLOWED_PARENT_REGEX);
            if (found?.groups) {
              uid = `${found.groups.type}::"${found.groups.id}"`;
              parentsError = true;
            }
          }
        }
      }
    }
  }

  if (uid) {
    const entityRanges = parseCedarDocEntities(document, undefined);
    entityRanges.forEach((entityRange, index) => {
      if (entityRange.uid === uid) {
        const attributeRange = entityRange.attrsNameRanges.hasOwnProperty(
          attribute
        )
          ? entityRange.attrsNameRanges[attribute]
          : null;
        let diagnosticRange =
          attributeRange ||
          entityRange.attrsKeyRange ||
          entityRange.uidKeyRange;
        if (uidTypeError) {
          diagnosticRange = entityRange.uidTypeRange || entityRange.uidKeyRange;
        } else if (parentsError) {
          diagnosticRange = entityRange.parentsRange || entityRange.uidKeyRange;
        }
        addDiagnosticsError(diagnostics, diagnosticRange, error);
      }
    });
    return true;
  }

  return false;
};

export const addSyntaxDiagnosticErrors = (
  diagnostics: vscode.Diagnostic[],
  errors: string[],
  document: vscode.TextDocument
) => {
  // create an error for each of the syntax validator errors
  errors.forEach((e) => {
    // error while deserializing entities: Attribute "subjects" on PhotoApp::Photo2::"Judges.jpg" shouldn't exist according to the schema
    if (e.startsWith('error while deserializing entities')) {
      e = e.substring(e.indexOf(': ') + 2);

      if (handleEntitiesDiagnosticError(diagnostics, document, e)) {
        return;
      }
    } else if (e.startsWith('JSON Schema file could not be parsed: ')) {
      e = e.substring(e.indexOf(': ') + 2);
    }

    let found = e.match(UNDECLARED_REGEX);
    if (found?.groups && found?.groups.undeclared) {
      addUndeclaredDiagnosticErrors(diagnostics, document, found);
    }

    const range = parseRangeFromError(e, document);
    addDiagnosticsError(diagnostics, range, e);
  });
};

export const addValidationDiagnosticInfo = (
  diagnostics: vscode.Diagnostic[],
  info: string
) => {
  const diagnostic = new vscode.Diagnostic(
    DEFAULT_RANGE,
    info,
    vscode.DiagnosticSeverity.Information
  );
  diagnostic.source = SOURCE_CEDAR;
  diagnostics.push(diagnostic);
};

export const addPolicyResultErrors = (
  diagnostics: vscode.Diagnostic[],
  errors: string[],
  policy: string,
  effectRange: vscode.Range,
  startLine: number
) => {
  // create an error for each of the errors
  errors.forEach((e) => {
    let diagnosticCode = undefined;
    let range = parseRangeFromPolicyError(e, policy, effectRange, startLine);
    if (e.startsWith('Validation error on policy')) {
      e = e.substring(e.indexOf(': ') + 2);
    }

    let found = e.match(UNRECOGNIZED_REGEX);
    if (found?.groups && found?.groups.unrecognized) {
      const lines = policy.split('\n');
      // not efficient, but Cedar policies are small
      for (let i = 0; i < lines.length; i++) {
        // unrecognized Actions end in "
        const suffix = found?.groups.unrecognized.endsWith('"') ? '' : '::';
        const startCharacter = lines[i].indexOf(
          found?.groups.unrecognized + suffix
        );
        if (startCharacter > -1) {
          const endCharacter =
            startCharacter + found?.groups.unrecognized.length;
          range = new vscode.Range(
            new vscode.Position(startLine + i, startCharacter),
            new vscode.Position(startLine + i, endCharacter)
          );

          diagnosticCode = 'unrecognized';
          break;
        }
      }
    }

    const diagnostic = new vscode.Diagnostic(
      range,
      e,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = SOURCE_CEDAR;
    if (diagnosticCode) {
      diagnostic.code = diagnosticCode;
    }
    diagnostics.push(diagnostic);
  });
};

export const reportFormatterOff = (
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): boolean => {
  let { skipFormatting, formatterDirectiveRange } =
    scanLeadingComments(document);

  if (skipFormatting && formatterDirectiveRange) {
    const diagnostic = new vscode.Diagnostic(
      formatterDirectiveRange,
      'Cedar formatting disabled by @formatter:off',
      vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = SOURCE_CEDAR;
    diagnostics.push(diagnostic);
  }

  return skipFormatting;
};

export const scanLeadingComments = (
  document: vscode.TextDocument
): {
  firstNonCommentLine: number;
  skipFormatting: boolean;
  formatterDirectiveRange: vscode.Range | undefined;
} => {
  let skipFormatting = false;
  let firstNonCommentLine = 0;
  let formatterDirectiveRange: vscode.Range | undefined;
  for (let i = 0; i < document.lineCount; i++) {
    const textLine = document.lineAt(i).text;
    if (!textLine.startsWith('//')) {
      firstNonCommentLine = i;
      break;
    } else {
      // look for JetBrains style directive to disable formatting
      const OFF = '@formatter:off';
      const idx = textLine.indexOf(OFF);
      if (idx > 0) {
        formatterDirectiveRange = new vscode.Range(
          new vscode.Position(i, idx),
          new vscode.Position(i, idx + OFF.length)
        );
        skipFormatting = true;
      }
    }
  }

  return {
    firstNonCommentLine,
    skipFormatting,
    formatterDirectiveRange,
  };
};
