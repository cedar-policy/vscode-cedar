// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { parseCedarEntitiesDoc, parseCedarSchemaDoc } from './parser';
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
  AT_LINE_SCHEMA_REGEX,
  UNDECLARED_REGEX,
  UNRECOGNIZED_REGEX,
  EXPECTED_ATTR2_REGEX,
  NOTDECLARED_TYPE_REGEX,
  NOTALLOWED_PARENT_REGEX,
  PARSE_ERROR_SCHEMA_REGEX,
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

const determineRangeFromPolicyError = (
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

const determineRangeFromError = (
  vse: {
    message: string;
    offset: number;
    length: number;
  },
  document: vscode.TextDocument
): { error: string; range: vscode.Range } => {
  let error = vse.message;
  let range = DEFAULT_RANGE;
  if (vse.offset > 0) {
    const startCharacter = vse.offset;
    // "invalid token" is 0 length, make range at least 1 character
    const endCharacter = vse.offset + Math.max(vse.length, 1);
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
    const found = error.match(AT_LINE_SCHEMA_REGEX);
    if (found) {
      if (found?.index) {
        error = error.substring(0, found.index);
      }
      if (found?.groups) {
        const line = parseInt(found?.groups.line);
        const column = parseInt(found?.groups.column);
        if (line && column) {
          range = new vscode.Range(
            new vscode.Position(line - 1, column - 1),
            new vscode.Position(line - 1, column - 1)
          );
        }
      }
    } else if (
      error === 'Entity type `Action` declared in `entityTypes` list.'
    ) {
      const definitionRanges = parseCedarSchemaDoc(document).definitionRanges;
      for (let definitionRange of definitionRanges) {
        if (
          definitionRange.etype === 'Action' ||
          definitionRange.etype.endsWith('::Action')
        ) {
          range = definitionRange.etypeRange;
          break;
        }
      }
    }
  }

  return { error, range };
};

const addUndeclaredDiagnosticErrors = (
  diagnostics: vscode.Diagnostic[],
  document: vscode.TextDocument,
  found: RegExpMatchArray
): vscode.Range => {
  let parentRange = DEFAULT_RANGE;
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
      const len = pathSupplier().length;
      if (len === 0 && property) {
        namespace = property + '::';
      } else if (
        (len === 1 &&
          property === 'entityTypes' &&
          undeclaredType === 'entity types') ||
        (len === 1 && property === 'actions' && undeclaredType === 'actions') ||
        (len === 1 &&
          property === 'commonTypes' &&
          undeclaredType === 'common types')
      ) {
        parentRange = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );
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
        if (undeclaredType === 'entity types') {
          undeclaredTypes?.forEach((t) => {
            const currentType = `"${namespace}${value}"`;
            if (t === currentType) {
              addDiagnosticsError(
                diagnostics,
                range,
                `undeclared entity type: ${value}`,
                'undeclared'
              );
            }
          });
        }
      } else if (
        undeclaredType === 'actions' &&
        jsonPathLen === 6 &&
        pathSupplier()[1] === 'actions' &&
        pathSupplier()[3] === 'memberOf' &&
        pathSupplier()[5] === 'id'
      ) {
        undeclaredTypes?.forEach((t) => {
          const currentType = `"${namespace}Action::\\"${value}\\""`;
          if (t === currentType) {
            addDiagnosticsError(
              diagnostics,
              range,
              `undeclared action: ${value}`,
              'undeclared'
            );
          }
        });
      } else if (
        undeclaredType === 'common types' &&
        pathSupplier()[jsonPathLen - 1] === 'type'
      ) {
        undeclaredTypes?.forEach((t) => {
          const currentType = `"${value}"`;
          if (t === currentType) {
            addDiagnosticsError(
              diagnostics,
              range,
              `undeclared common type: ${value}`,
              'undeclared'
            );
          }
        });
      }
    },
  });

  return parentRange;
};

const rangeFromParseError = (
  document: vscode.TextDocument,
  found: RegExpMatchArray
): vscode.Range => {
  let parentRange = DEFAULT_RANGE;
  const parseErrorType = found.groups?.type;

  jsonc.visit(document.getText(), {
    onObjectProperty(
      property,
      offset,
      length,
      startLine,
      startCharacter,
      pathSupplier
    ) {
      const len = pathSupplier().length;
      if (
        (len === 0 && parseErrorType === 'namespace') ||
        (len === 1 &&
          property === 'entityTypes' &&
          parseErrorType === 'entity type') ||
        (len === 1 &&
          property === 'commonTypes' &&
          parseErrorType === 'common type')
      ) {
        parentRange = new vscode.Range(
          new vscode.Position(startLine, startCharacter + 1),
          new vscode.Position(startLine, startCharacter + length - 1)
        );
      }
    },
  });

  return parentRange;
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
    const entityRanges = parseCedarEntitiesDoc(document).entities;
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
  errors: Array<{
    message: string;
    offset: number;
    length: number;
  }>,
  document: vscode.TextDocument
) => {
  // create an error for each of the syntax validator errors
  errors.forEach((vse) => {
    let e = vse.message;
    // entities deserialization error: Attribute "subjects" on PhotoApp::Photo2::"Judges.jpg" shouldn't exist according to the schema
    if (e.startsWith('entities deserialization error')) {
      e = e.substring(e.indexOf(': ') + 2);

      if (handleEntitiesDiagnosticError(diagnostics, document, e)) {
        return;
      }
    } else if (e.startsWith('JSON Schema file could not be parsed: ')) {
      e = e.substring(e.indexOf(': ') + 2);
    }

    let found = e.match(UNDECLARED_REGEX);
    if (found?.groups && found?.groups.undeclared) {
      let range = addUndeclaredDiagnosticErrors(diagnostics, document, found);
      addDiagnosticsError(diagnostics, range, e);
      return;
    }

    // defend against future parse errors including the range
    if (vse.offset === 0 && vse.length === 0) {
      found = e.match(PARSE_ERROR_SCHEMA_REGEX);
      if (found?.groups && found?.groups.type) {
        let range = rangeFromParseError(document, found);
        addDiagnosticsError(diagnostics, range, e);
        return;
      }
    }

    const { error, range } = determineRangeFromError(
      { ...vse, message: e },
      document
    );
    if (
      error === 'EOF while parsing a value' &&
      document.getText().trim() === ''
    ) {
      addDiagnosticsError(diagnostics, range, error, 'empty');
    } else {
      addDiagnosticsError(diagnostics, range, error);
    }
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
    let range = determineRangeFromPolicyError(
      e,
      policy,
      effectRange,
      startLine
    );
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
