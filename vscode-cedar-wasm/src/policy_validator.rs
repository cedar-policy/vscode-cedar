// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{
    validation_errors::EntityDerefLevelViolation, PolicySet, Schema, ValidationError,
    ValidationMode, Validator,
};
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

use crate::validate_message::{convert_messages_to_js_array, ValidateMessage};

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_POLICY_RESULT: &'static str = r#"
export class ValidatePolicyResult {
  free(): void;
  readonly success: boolean;
  readonly warnings: Array<ValidateMessage> | undefined;
  readonly errors: Array<ValidateMessage> | undefined;
  readonly level: number | undefined;
  readonly levelWarnings: Array<ValidateMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidatePolicyResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    warnings: Option<Vec<ValidateMessage>>,
    errors: Option<Vec<ValidateMessage>>,
    /// minimum entity dereference level (RFC 76) the policies validate at,
    /// `None` if validation failed or an entity literal is dereferenced
    #[wasm_bindgen(readonly)]
    pub level: Option<u32>,
    level_warnings: Option<Vec<ValidateMessage>>,
}

#[wasm_bindgen]
impl ValidatePolicyResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        self.errors.as_ref().map(convert_messages_to_js_array)
    }

    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> Option<js_sys::Array> {
        self.warnings.as_ref().map(convert_messages_to_js_array)
    }

    #[wasm_bindgen(getter, js_name = levelWarnings)]
    pub fn level_warnings(&self) -> Option<js_sys::Array> {
        self.level_warnings
            .as_ref()
            .map(convert_messages_to_js_array)
    }
}

#[wasm_bindgen(js_name = validatePolicySchemaJSON)]
pub fn validate_policy_schema_json(
    input_schema_str: &str,
    input_policies_str: &str,
    max_level: Option<u32>,
) -> ValidatePolicyResult {
    let schema = match Schema::from_json_str(&input_schema_str) {
        Ok(schema) => schema,
        Err(e) => {
            // example error message
            // JSON Schema file could not be parsed: expected `,` or `}` at line 8 column 38'
            return ValidatePolicyResult {
                success: false,
                warnings: None,
                errors: Some(vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }]),
                level: None,
                level_warnings: None,
            };
        }
    };
    return validate_policy_schema(schema, input_policies_str, max_level);
}

#[wasm_bindgen(js_name = validatePolicySchemaCedar)]
pub fn validate_policy_schema_cedar(
    input_schema_str: &str,
    input_policies_str: &str,
    max_level: Option<u32>,
) -> ValidatePolicyResult {
    let schema_tuple = match Schema::from_cedarschema_str(&input_schema_str) {
        Ok(schema_tuple) => schema_tuple,
        Err(e) => {
            return ValidatePolicyResult {
                success: false,
                warnings: None,
                errors: Some(vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }]),
                level: None,
                level_warnings: None,
            };
        }
    };
    return validate_policy_schema(schema_tuple.0, input_policies_str, max_level);
}

/// Convert a validation error or warning into a message per labeled span
fn push_messages<D: Diagnostic + std::fmt::Display>(d: &D, messages: &mut Vec<ValidateMessage>) {
    d.labels().iter_mut().for_each(|labels| {
        labels.as_mut().for_each(|labeled_span| {
            let vpm = ValidateMessage {
                message: match labeled_span.label() {
                    None => match d.help() {
                        None => d.to_string(),
                        Some(help) => format!("{}\n{}", d, help),
                    },
                    Some(msg) => match d.help() {
                        None => format!("{}\n{}", d, msg),
                        Some(help) => format!("{}\n{}\n{}", d, msg, help),
                    },
                },
                offset: labeled_span.offset(),
                length: labeled_span.len(),
            };
            messages.push(vpm);
        });
    });
}

const REQUIRES_LEVEL: &str = "requires level ";

/// The level required by an entity dereference, or `None` for a dereference
/// which isn't allowed at any level (an entity literal).  The public API only
/// exposes the level through the error message, which reads
/// "for policy `policy0`, this policy requires level 2, which exceeds the maximum allowed level (0)"
fn required_level(e: &EntityDerefLevelViolation) -> Option<u32> {
    let msg = e.to_string();
    let start = msg.rfind(REQUIRES_LEVEL)? + REQUIRES_LEVEL.len();
    let digits: String = msg[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Determine the minimum level the policies validate at (RFC 76) by level
/// validating at level 0, where every entity dereference reports its level
fn minimum_level(validator: &Validator, pset: &PolicySet) -> Option<u32> {
    let result = validator.validate_with_level(pset, ValidationMode::Strict, 0);
    let mut level = 0;
    for e in result.validation_errors() {
        if let ValidationError::EntityDerefLevelViolation(e) = e {
            level = level.max(required_level(e)?);
        }
    }
    Some(level)
}

/// Entity dereference violations when level validating at `max_level`
fn level_violations(
    validator: &Validator,
    pset: &PolicySet,
    max_level: u32,
) -> Vec<ValidateMessage> {
    let result = validator.validate_with_level(pset, ValidationMode::Strict, max_level);
    let mut messages = Vec::new();
    for e in result.validation_errors() {
        if let ValidationError::EntityDerefLevelViolation(e) = e {
            push_messages(e, &mut messages);
        }
    }
    messages
}

fn validate_policy_schema(
    schema: Schema,
    input_policies_str: &str,
    max_level: Option<u32>,
) -> ValidatePolicyResult {
    let validator = Validator::new(schema);
    let pset = match PolicySet::from_str(&input_policies_str) {
        Ok(pset) => pset,
        Err(_e) => {
            return ValidatePolicyResult {
                success: false,
                warnings: None,
                errors: None,
                level: None,
                level_warnings: None,
            }
        }
    };
    let result = validator.validate(&pset, ValidationMode::Strict);

    let mut validate_warnings = Vec::new();
    result
        .validation_warnings()
        .for_each(|w| push_messages(w, &mut validate_warnings));
    let warnings = if validate_warnings.is_empty() {
        None
    } else {
        Some(validate_warnings)
    };

    if result.validation_passed() {
        // level validation only reports levels for policies which typecheck
        let level = minimum_level(&validator, &pset);
        let level_warnings = match max_level {
            Some(max_level) if level.map_or(true, |level| level > max_level) => {
                Some(level_violations(&validator, &pset, max_level))
            }
            _ => None,
        };
        return ValidatePolicyResult {
            success: true,
            warnings,
            errors: None,
            level,
            level_warnings,
        };
    } else {
        let mut validate_errs = Vec::new();
        result
            .validation_errors()
            .for_each(|e| push_messages(e, &mut validate_errs));

        return ValidatePolicyResult {
            success: false,
            warnings,
            errors: Some(validate_errs),
            level: None,
            level_warnings: None,
        };
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn analyze_policy_permit() {
        let result = validate_policy_schema_json(
            "{ \"entityTypes\": [], \"actions\": [] }",
            "permit(principal, action, resource);",
            None,
        );
        assert!(matches!(
            result,
            ValidatePolicyResult {
                success: false,
                warnings: _,
                errors: _,
                level: None,
                level_warnings: None,
            }
        ));
    }

    const LEVEL_SCHEMA: &str = r#"
entity User { manager: User, name: String };
entity Photo { owner: User };
action view appliesTo { principal: User, resource: Photo };
"#;

    fn level_of(policy: &str, max_level: Option<u32>) -> ValidatePolicyResult {
        validate_policy_schema_cedar(LEVEL_SCHEMA, policy, max_level)
    }

    #[test]
    fn level_zero() {
        let result = level_of("permit(principal, action, resource);", Some(0));
        assert!(result.success);
        assert_eq!(result.level, Some(0));
        assert!(result.level_warnings.is_none());
    }

    #[test]
    fn level_one() {
        let result = level_of(
            "permit(principal, action, resource) when { principal.name == \"a\" };",
            None,
        );
        assert!(result.success);
        assert_eq!(result.level, Some(1));
        assert!(result.level_warnings.is_none());
    }

    #[test]
    fn level_two_exceeds_max() {
        let result = level_of(
            "permit(principal, action, resource) when { resource.owner.manager == principal };",
            Some(1),
        );
        assert!(result.success);
        assert_eq!(result.level, Some(2));
        let warnings = result.level_warnings.unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].message.contains("requires level 2"));
        assert!(warnings[0].length > 0);
    }

    #[test]
    fn level_within_max() {
        let result = level_of(
            "permit(principal, action, resource) when { resource.owner.manager == principal };",
            Some(2),
        );
        assert_eq!(result.level, Some(2));
        assert!(result.level_warnings.is_none());
    }

    #[test]
    fn level_entity_literal() {
        let result = level_of(
            "permit(principal, action, resource) when { User::\"alice\".name == \"a\" };",
            Some(3),
        );
        assert!(result.success);
        assert_eq!(result.level, None);
        assert_eq!(result.level_warnings.unwrap().len(), 1);
    }

    #[test]
    fn level_invalid_policy() {
        let result = level_of(
            "permit(principal, action, resource) when { principal.nope };",
            Some(0),
        );
        assert!(!result.success);
        assert_eq!(result.level, None);
        assert!(result.level_warnings.is_none());
    }
}
