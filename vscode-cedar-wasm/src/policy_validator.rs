// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{PolicySet, Schema, ValidationMode, Validator};
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_POLICY_RESULT: &'static str = r#"
export class ValidatePolicyResult {
  free(): void;
  readonly success: boolean;
  readonly errors: Array<string> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidatePolicyResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    errors: Option<Vec<String>>,
}

#[wasm_bindgen]
impl ValidatePolicyResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        if let Some(errors) = &self.errors {
            let arr = js_sys::Array::new_with_length(errors.len() as u32);
            for (i, s) in errors.iter().enumerate() {
                arr.set(i as u32, JsValue::from_str(s));
            }
            Some(arr)
        } else {
            None
        }
    }
}

#[wasm_bindgen(js_name = validatePolicy)]
pub fn validate_policy(input_schema_str: &str, input_policies_str: &str) -> ValidatePolicyResult {
    let schema = match Schema::from_str(&input_schema_str) {
        Ok(schema) => schema,
        Err(e) => {
            // example error message
            // JSON Schema file could not be parsed: expected `,` or `}` at line 8 column 38'
            return ValidatePolicyResult {
                success: false,
                errors: Some(vec![String::from(&format!("{e}"))]),
            };
        }
    };
    return validate_policy_schema(schema, input_policies_str);
}

#[wasm_bindgen(js_name = validatePolicyNatural)]
pub fn validate_policy_natural(
    input_schema_str: &str,
    input_policies_str: &str,
) -> ValidatePolicyResult {
    let schema_tuple = match Schema::from_cedarschema_str(&input_schema_str) {
        Ok(schema_tuple) => schema_tuple,
        Err(e) => {
            return ValidatePolicyResult {
                success: false,
                errors: Some(vec![String::from(&format!("{e}"))]),
            }
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
        // result.labels().into_iter().for_each(|labels| {
        //     labels.into_iter().for_each(|labeled_span| {
        //         let message = match labeled_span.label() {
        //             None => match result.help() {
        //                 None => result.to_string(),
        //                 Some(help) => format!("{}\n{}", result, help),
        //             },
        //             Some(msg) => match result.help() {
        //                 None => format!("{}\n{}", result, msg),
        //                 Some(help) => format!("{}\n{}\n{}", result, msg, help),
        //             },
        //         };
        //         validate_errs.push(message);
        //     });
        // });
        result.validation_errors().for_each(|e| {
            match e.help() {
                None => validate_errs.push(format!("{e}")),
                Some(help) => validate_errs.push(format!("{e}\n{help}")),
            }
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
        let result = validate_policy(
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
