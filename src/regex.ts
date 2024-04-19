// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

export const IDENT_REGEX = /^[_a-zA-Z][_a-zA-Z0-9]*$/;
export const PATH_REGEX = /^([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*$/;
export const ENTITY_REGEXG =
  /(?<type>(?:[_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*)(?:::"(?<id>(?:[^"]*))")?/g;
export const PROPERTY_CHAIN_REGEX =
  /\b(?<!\.)(?<element>(([_a-zA-Z][_a-zA-Z0-9]*::)*[_a-zA-Z][_a-zA-Z0-9]*::"(?<id>([^"]*))"|principal|resource|context))((\.[_a-zA-Z][_a-zA-Z0-9]*|\["([^"]*)"\]))*(?<trigger>.?)$/;

// parses out start / end characters from Cedar validator
export const PARSE_ERROR_SCHEMA_REGEX =
  /(P|p)arse error in (?<type>(entity type|common type|namespace))( identifier)?: /;
export const AT_LINE_SCHEMA_REGEX =
  / at line (?<line>(\d)+)? column (?<column>(\d)+)?/;
export const OFFSET_POLICY_REGEX =
  / at offset (?<start>(\d)+)(-)?(?<end>(\d)+)?: /;
export const UNRECOGNIZED_REGEX =
  /unrecognized (action|entity type) `(?<unrecognized>.+)`(, did you mean `(?<suggestion>.+)`\?)?/;
export const UNDECLARED_REGEX =
  /(U|u)ndeclared (?<type>(entity type\(s\)|common type\(s\)|action\(s\))): {(?<undeclared>.+)}/;
// Cedar entities errors
export const NOTDECLARED_TYPE_REGEX =
  /entity `(?<type>.+)::"(?<id>.+)"` has type `(.+)` which is not declared in the schema(. Did you mean `(?<suggestion>.+)`\?)?/;
export const EXPECTED_ATTR_REGEX =
  /expected entity `(?<type>.+)::"(?<id>.+)"` to have attribute `(?<suggestion>.+)`, but it does not/;
export const EXPECTED_ATTR2_REGEX =
  /in attribute `(?<attribute>.+)` on `(?<type>.+)::"(?<id>.+)"`, expected the record to have an attribute `(?<suggestion>.+)`, but it does not/;
export const MISMATCH_ATTR_REGEX =
  /in attribute `(?<attribute>.+)` on `(?<type>.+)::"(?<id>.+)"`, type mismatch: value was expected to have type (\(entity of type )?(?<suggestion>.+)(\))?, but actually has type (\(entity of type )?(?<unrecognized>.+)(\))?/;
export const EXIST_ATTR_REGEX =
  /attribute `(?<attribute>.+)` on `(?<type>.+)::"(?<id>.+)"` should not exist according to the schema/;
export const NOTALLOWED_PARENT_REGEX =
  /`(?<type>.+)::"(?<id>.+)"` is not allowed to have an ancestor of type `(?<undeclared>.+)` according to the schema/;
export const UNKNOWN_ENTITY_REGEX =
  /in uid field of <unknown entity>, expected a literal entity reference, but got `"(?<unknown>.+)"`/;
