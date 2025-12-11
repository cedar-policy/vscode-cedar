// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as cedar from 'vscode-cedar-wasm';
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
  UNRECOGNIZED_REGEX,
  EXPECTED_ATTR2_REGEX,
  NOTDECLARED_TYPE_REGEX,
  NOTALLOWED_PARENT_REGEX,
  PARSE_ERROR_SCHEMA_REGEX,
  UNKNOWN_ENTITY_REGEX,
  UNDECLARED_ACTION_REGEX,
  UNDECLARED_REGEX,
  UNDECLAREDS_REGEX,
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

const determineRangeFromPolicyMessage = (
  vpm: cedar.ValidateMessage,
  policy: string,
  defaultErrorRange: vscode.Range,
  startLine: number
): vscode.Range => {
  let range = defaultErrorRange;
  let startCharacter = vpm.offset;
  let endCharacter = vpm.offset + vpm.length;

  // TODO: investigate if this still is a valid path
  let found = vpm.message.match(OFFSET_POLICY_REGEX);
  if (found?.groups) {
    startCharacter = parseInt(found?.groups.start);
    endCharacter = parseInt(found?.groups.end) || startCharacter;
  }

  if (startCharacter > 0 && endCharacter > 0) {
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

export const determineRangeFromOffset = (
  document: vscode.TextDocument,
  offset: number,
  length: number
): vscode.Range => {
  let range = DEFAULT_RANGE;
  const startCharacter = offset;
  // "invalid token" is 0 length, make range at least 1 character
  const endCharacter = offset + Math.max(length, 1);
  let lineStart = 0;
  // not efficient, but Cedar documents are small
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
    range = determineRangeFromOffset(document, vse.offset, vse.length);
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
  undeclaredName: string,
  undeclaredType: string
): vscode.Range => {
  let parentRange = DEFAULT_RANGE;
  const undeclaredNames = [undeclaredName];

  let namespace = '';

  if (document.languageId === 'cedarschema') {
    if (['entityTypes', 'commonTypes'].includes(undeclaredType)) {
      const referencedTypes = parseCedarSchemaDoc(document).referencedTypes;
      undeclaredNames?.forEach((t) => {
        for (let referencedType of referencedTypes) {
          if (referencedType.name === t) {
            addDiagnosticsError(
              diagnostics,
              referencedType.range,
              `undeclared ${undeclaredType.replace('Types', ' type')}: ${t}`,
              'undeclared'
            );
          }
        }
      });
    }

    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(lastLine.range.end, lastLine.range.end);
  }

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
      } else if (len === 1 && property === undeclaredType) {
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
        if (undeclaredType === 'entityTypes') {
          undeclaredNames?.forEach((t) => {
            if (t === value) {
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
        undeclaredNames?.forEach((t) => {
          const currentType = `${namespace}Action::"${value}"`;
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
        undeclaredType === 'commonTypes' &&
        pathSupplier()[jsonPathLen - 1] === 'type'
      ) {
        undeclaredNames?.forEach((t) => {
          if (t === value) {
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
  undeclaredType: string
): vscode.Range => {
  let parentRange = DEFAULT_RANGE;

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
        (len === 0 && undeclaredType === 'namespace') ||
        (len === 1 &&
          property === 'entityTypes' &&
          undeclaredType === 'entity type') ||
        (len === 1 &&
          property === 'commonTypes' &&
          undeclaredType === 'common type')
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
            found = error.match(UNKNOWN_ENTITY_REGEX);
            if (found?.groups) {
              uid = found.groups.unknown.replaceAll('\\"', '"');
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
    if (
      e.startsWith('entity does not conform to the schema: ') ||
      e.startsWith('error during entity deserialization: ')
    ) {
      e = e.substring(e.indexOf(': ') + 2);

      if (handleEntitiesDiagnosticError(diagnostics, document, e)) {
        return;
      }
    } else if (e.startsWith('JSON Schema file could not be parsed: ')) {
      e = e.substring(e.indexOf(': ') + 2);
    }

    let found = e.match(UNDECLARED_REGEX);
    if (!found) {
      found = e.match(UNDECLAREDS_REGEX);
    }
    if (!found) {
      found = e.match(UNDECLARED_ACTION_REGEX);
    }
    if (found?.groups && found?.groups.undeclared) {
      const undeclaredName = found.groups.undeclared;
      const mappings = {
        action: 'actions',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'an action': 'actions',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'an entity type': 'entityTypes',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'a common type': 'commonTypes',
      };
      const undeclaredType =
        mappings[found.groups.type as keyof typeof mappings];
      // let range = determineRangeFromOffset(document, vse.offset, vse.length);
      let endOfDocRange = addUndeclaredDiagnosticErrors(
        diagnostics,
        document,
        undeclaredName,
        undeclaredType
      );
      addDiagnosticsError(diagnostics, endOfDocRange, e);
      return;
    }

    // defend against future parse errors including the range
    if (vse.offset === 0 && vse.length === 0) {
      found = e.match(PARSE_ERROR_SCHEMA_REGEX);
      if (found?.groups && found?.groups.type) {
        let range = rangeFromParseError(document, found?.groups.type);
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

export const addValidationDiagnosticWarning = (
  diagnostics: vscode.Diagnostic[],
  message: string,
  range: vscode.Range = DEFAULT_RANGE
) => {
  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = SOURCE_CEDAR;
  diagnostics.push(diagnostic);
};

export const addPolicyResultMessages = (
  diagnostics: vscode.Diagnostic[],
  messages: cedar.ValidateMessage[],
  policy: string,
  effectRange: vscode.Range,
  startLine: number,
  areWarnings: boolean
) => {
  // create an error for each of the errors
  messages.forEach((vpm) => {
    let e = vpm.message;
    let diagnosticCode = undefined;
    let range = determineRangeFromPolicyMessage(
      vpm,
      policy,
      effectRange,
      startLine
    );
    if (
      e.startsWith('validation error on policy `policy0`') ||
      e.startsWith('validation error on `policy `policy0`')
    ) {
      // validation error on `policy `policy0``: unable to find an applicable action given the policy head constraints
      // validation error on `policy `policy0` at offset 267-285`: attribute `a` for entity type NS::e not found, did you mean `b`?
      e = e.substring(e.indexOf(': ') + 2);
    } else if (e.startsWith('for policy `policy0`, ')) {
      e = e.substring(e.indexOf(', ') + 2);
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
      areWarnings
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error
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
