// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{PolicySet, Schema, ValidationMode, Validator};
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
  readonly errors: Array<ValidateMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidatePolicyResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    errors: Option<Vec<ValidateMessage>>,
}

#[wasm_bindgen]
impl ValidatePolicyResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        self.errors.as_ref().map(convert_messages_to_js_array)
    }
}

#[wasm_bindgen(js_name = validatePolicySchemaJSON)]
pub fn validate_policy_schema_json(
    input_schema_str: &str,
    input_policies_str: &str,
) -> ValidatePolicyResult {
    let schema = match Schema::from_json_str(&input_schema_str) {
        Ok(schema) => schema,
        Err(e) => {
            // example error message
            // JSON Schema file could not be parsed: expected `,` or `}` at line 8 column 38'
            return ValidatePolicyResult {
                success: false,
                errors: Some(vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }]),
            };
        }
    };
    return validate_policy_schema(schema, input_policies_str);
}

#[wasm_bindgen(js_name = validatePolicySchemaCedar)]
pub fn validate_policy_schema_cedar(
    input_schema_str: &str,
    input_policies_str: &str,
) -> ValidatePolicyResult {
    let schema_tuple = match Schema::from_cedarschema_str(&input_schema_str) {
        Ok(schema_tuple) => schema_tuple,
        Err(e) => {
            return ValidatePolicyResult {
                success: false,
                errors: Some(vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }]),
            };
        }
    };
    return validate_policy_schema(schema_tuple.0, input_policies_str);
}

fn validate_policy_schema(schema: Schema, input_policies_str: &str) -> ValidatePolicyResult {
    let validator = Validator::new(schema);
    let pset = match PolicySet::from_str(&input_policies_str) {
        Ok(pset) => pset,
        Err(_e) => {
            return ValidatePolicyResult {
                success: false,
                errors: None,
            }
        }
    };
    let result = validator.validate(&pset, ValidationMode::Strict);
    if result.validation_passed() {
        return ValidatePolicyResult {
            success: true,
            errors: None,
        };
    } else {
        let mut validate_errs = Vec::new();
        result.validation_errors().for_each(|e| {
            e.labels().iter_mut().for_each(|labels| {
                labels.as_mut().for_each(|labeled_span| {
                    let vpm = ValidateMessage {
                        message: match labeled_span.label() {
                            None => match e.help() {
                                None => e.to_string(),
                                Some(help) => format!("{}\n{}", e, help),
                            },
                            Some(msg) => match e.help() {
                                None => format!("{}\n{}", e, msg),
                                Some(help) => format!("{}\n{}\n{}", e, msg, help),
                            },
                        },
                        offset: labeled_span.offset(),
                        length: labeled_span.len(),
                    };
                    validate_errs.push(vpm);
                });
            });
        });
        return ValidatePolicyResult {
            success: false,
            errors: Some(validate_errs),
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
        );
        assert!(matches!(
            result,
            ValidatePolicyResult {
                success: false,
                errors: _,
            }
        ));
    }
}
