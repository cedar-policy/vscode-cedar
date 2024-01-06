// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export const ENTITY_REGEX = /(?<type>.+)::"(?<id>.+)"/;
export const EFFECT_ENTITY_REGEX =
  /(principal|resource)\s+(==|in)(\s|\[)+(?<type>.+?)::"/g;
export const EFFECT_ACTION_REGEX =
  /\b(?<type>([^\s]+::Action|Action))::"(?<id>.+?)"/g;

// parses out start / end characters from Cedar validator
export const PARSE_ERROR_SCHEMA_REGEX =
  /(P|p)arse error in (?<type>(entity type|common type|namespace))( identifier)?: /;
export const AT_LINE_SCHEMA_REGEX =
  / at line (?<line>(\d)+)? column (?<column>(\d)+)?/;
export const OFFSET_POLICY_REGEX =
  / at offset (?<start>(\d)+)(-)?(?<end>(\d)+)?: /;
export const UNRECOGNIZED_REGEX =
  /unrecognized (action|entity type) `(?<unrecognized>.+)`, did you mean `(?<suggestion>.+)`\?/;
export const UNDECLARED_REGEX =
  /(U|u)ndeclared (?<type>(entity types|common types|actions)): {(?<undeclared>.+)}/;
// Cedar entities errors
export const NOTDECLARED_TYPE_REGEX =
  /entity `(?<type>.+)::"(?<id>.+)"` has type `(.+)` which is not declared in the schema; did you mean (?<suggestion>.+)\?/;
export const EXPECTED_ATTR_REGEX =
  /expected entity `(?<type>.+)::"(?<id>.+)"` to have an attribute "(?<suggestion>.+)", but it doesn't/;
export const EXPECTED_ATTR2_REGEX =
  /in attribute "(?<attribute>.+)" on (?<type>.+)::"(?<id>.+)", expected the record to have an attribute "(?<suggestion>.+)", but it doesn't/;
export const MISMATCH_ATTR_REGEX =
  /in attribute "(?<attribute>.+)" on (?<type>.+)::"(?<id>.+)", type mismatch: attribute was expected to have type (\(entity of type )?(?<suggestion>.+)(\))?, but actually has type (\(entity of type )?(?<unrecognized>.+)(\))?/;
export const EXIST_ATTR_REGEX =
  /attribute "(?<attribute>.+)" on `(?<type>.+)::"(?<id>.+)"` shouldn't exist according to the schema/;
export const NOTALLOWED_PARENT_REGEX =
  /in parents field of (?<type>.+)::"(?<id>.+)", (.+) is not allowed to have a parent of type (?<undeclared>.+) according to the schema/;
