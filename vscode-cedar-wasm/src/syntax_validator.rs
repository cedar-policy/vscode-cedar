// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::PolicySet;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

// use https://github.com/cloudflare/serde-wasm-bindgen ?

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_SCHEMA_RESULT: &'static str = r#"
export class ValidateSyntaxResult {
  free(): void;
  readonly errors: Array<string> | undefined;
  readonly policies: number | undefined;
  readonly success: boolean;
  readonly templates: number | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateSyntaxResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    #[wasm_bindgen(readonly)]
    pub policies: Option<i32>,
    #[wasm_bindgen(readonly)]
    pub templates: Option<i32>,
    errors: Option<Vec<String>>,
}

#[wasm_bindgen]
impl ValidateSyntaxResult {
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

#[wasm_bindgen(js_name = validateSyntax)]
pub fn validate_syntax(input_policies_str: &str) -> ValidateSyntaxResult {
    let parse_result = match PolicySet::from_str(input_policies_str) {
        Err(validation_errors) => ValidateSyntaxResult {
            success: false,
            policies: None,
            templates: None,
            errors: Some(validation_errors.errors_as_strings()),
        },
        Ok(policy_set) => {
            let policies_count: Result<i32, <i32 as TryFrom<usize>>::Error> =
                policy_set.policies().count().try_into();
            let templates_count: Result<i32, <i32 as TryFrom<usize>>::Error> =
                policy_set.templates().count().try_into();
            match (policies_count, templates_count) {
                (Ok(p), Ok(t)) => ValidateSyntaxResult {
                    success: true,
                    policies: Some(p),
                    templates: Some(t),
                    errors: None,
                },
                _ => ValidateSyntaxResult {
                    success: false,
                    policies: None,
                    templates: None,
                    errors: Some(vec!["Error counting policies or templates".to_string()]),
                },
            }
        }
    };
    parse_result
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn validate_syntax_passes_1_policy() {
        let validation_result = validate_syntax("permit(principal, action, resource);");
        assert_result_is_ok(validation_result, 1);
    }

    #[test]
    fn validate_syntax_passes_multi_policy() {
        assert_result_is_ok(validate_syntax(
            "forbid(principal, action, resource); permit(principal == User::\"alice\", action == Action::\"view\", resource in Albums::\"alice_albums\");"
        ), 2);
    }

    #[test]
    fn validate_syntax_returns_validation_errors_when_expected_1_policy() {
        assert_result_had_syntax_errors(validate_syntax("permit(2pac, action, resource)"));
    }

    #[test]
    fn validate_syntax_returns_validation_errors_when_expected_multi_policy() {
        assert_result_had_syntax_errors(validate_syntax(
            "forbid(principal, action, resource);permit(2pac, action, resource)",
        ));
    }

    fn assert_result_is_ok(validation_result: ValidateSyntaxResult, expected_policies: i32) {
        assert!(matches!(
            validation_result,
            ValidateSyntaxResult {
                success: true,
                policies: expected_policies,
                templates: _,
                errors: _
            }
        ));
    }

    fn assert_result_had_syntax_errors(validation_result: ValidateSyntaxResult) {
        assert!(matches!(
            validation_result,
            ValidateSyntaxResult {
                success: false,
                policies: _,
                templates: _,
                errors: _
            }
        ));
    }
}
