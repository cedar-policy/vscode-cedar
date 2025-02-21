// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::PolicySet;
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

use crate::validate_message::{convert_messages_to_js_array, ValidateMessage};

// use https://github.com/cloudflare/serde-wasm-bindgen ?

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_SCHEMA_RESULT: &'static str = r#"
export class ValidateSyntaxResult {
  free(): void;
  readonly success: boolean;
  readonly policies: number | undefined;
  readonly templates: number | undefined;
  readonly errors: Array<ValidateMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateSyntaxResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    #[wasm_bindgen(readonly)]
    pub policies: Option<usize>,
    #[wasm_bindgen(readonly)]
    pub templates: Option<usize>,
    errors: Option<Vec<ValidateMessage>>,
}

#[wasm_bindgen]
impl ValidateSyntaxResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        self.errors.as_ref().map(convert_messages_to_js_array)
    }
}

#[wasm_bindgen(js_name = validateSyntax)]
pub fn validate_syntax(input_policies_str: &str) -> ValidateSyntaxResult {
    let parse_result = match PolicySet::from_str(input_policies_str) {
        Err(parse_errs) => {
            let mut syntax_errs = Vec::new();
            parse_errs.iter().for_each(|parse_err| {
                if parse_err.labels().into_iter().count() == 0 {
                    syntax_errs.push(ValidateMessage {
                        message: parse_err.to_string(),
                        length: 0,
                        offset: 0,
                    });
                } else {
                    parse_err.labels().into_iter().for_each(|labels| {
                        labels.into_iter().for_each(|labeled_span| {
                            let message = match (labeled_span.label(), parse_err.help()) {
                                (None, None) => parse_err.to_string(),
                                (None, Some(help)) => format!("{}\n{}", parse_err, help),
                                (Some(msg), None) => format!("{}\n{}", parse_err, msg),
                                (Some(msg), Some(help)) => {
                                    format!("{}\n{}\n{}", parse_err, msg, help)
                                }
                            };
                            syntax_errs.push(ValidateMessage {
                                message: message,
                                length: labeled_span.len(),
                                offset: labeled_span.offset(),
                            });
                        });
                    });
                };
            });
            ValidateSyntaxResult {
                success: false,
                policies: None,
                templates: None,
                errors: Some(syntax_errs),
            }
        }
        Ok(policy_set) => {
            let policies_count = policy_set.policies().count();
            let templates_count = policy_set.templates().count();
            ValidateSyntaxResult {
                success: true,
                policies: Some(policies_count),
                templates: Some(templates_count),
                errors: None,
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

    fn assert_result_is_ok(validation_result: ValidateSyntaxResult, expected_policies: usize) {
        assert!(validation_result.success);
        assert_eq!(validation_result.policies, Some(expected_policies));
    }

    fn assert_result_had_syntax_errors(validation_result: ValidateSyntaxResult) {
        assert!(!validation_result.success);
        assert!(validation_result.errors.is_some());
    }
}
