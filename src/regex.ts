// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// parses out start / end characters from Cedar validator
export const FOUND_AT_REGEX = /found at (?<start>(\d)+)(:)?(?<end>(\d)+)?\n/;
export const AT_LINE_SCHEMA_REGEX =
  /at line (?<line>(\d)+)? column (?<column>(\d)+)?/;
export const OFFSET_POLICY_REGEX =
  /at offset (?<start>(\d)+)(-)?(?<end>(\d)+)?: /;
export const UNRECOGNIZED_REGEX =
  /Unrecognized (action id|entity type) (?<unrecognized>.+), did you mean (?<suggestion>.+)\?/;
export const UNDECLARED_REGEX =
  /Undeclared ((?<type>entity|common) types|actions): {(?<undeclared>.+)}/;
// Cedar entities errors
export const NOTDECLARED_TYPE_REGEX =
  /(?<type>.+)::"(?<id>.+)" has type (.+) which is not declared in the schema/;
export const EXPECTED_ATTR_REGEX =
  /Expected (?<type>.+)::"(?<id>.+)" to have an attribute "(?<suggestion>.+)", but it didn't/;
export const EXPECTED_ATTR2_REGEX =
  /In attribute "(?<attribute>.+)" on (?<type>.+)::"(?<id>.+)", expected the record to have an attribute "(?<suggestion>.+)", but it didn't/;
export const MISMATCH_ATTR_REGEX =
  /In attribute "(?<attribute>.+)" on (?<type>.+)::"(?<id>.+)", type mismatch: attribute was expected to have type (\(entity of type )?(?<suggestion>.+)(\))?, but actually has type (\(entity of type )?(?<unrecognized>.+)(\))?/;
export const EXIST_ATTR_REGEX =
  /Attribute "(?<attribute>.+)" on (?<type>.+)::"(?<id>.+)" shouldn't exist according to the schema/;
export const NOTALLOWED_PARENT_REGEX =
  /In parents field of (?<type>.+)::"(?<id>.+)", (.+) is not allowed to have a parent of type (?<undeclared>.+) according to the schema/;
