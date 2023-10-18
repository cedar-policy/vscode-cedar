// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::PolicySet;
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

// use https://github.com/cloudflare/serde-wasm-bindgen ?

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_SCHEMA_RESULT: &'static str = r#"
export class ValidateSyntaxError {
  readonly message: string;
  readonly length: number;
  readonly offset: number;
}
export class ValidateSyntaxResult {
  free(): void;
  readonly success: boolean;
  readonly policies: number | undefined;
  readonly templates: number | undefined;
  readonly errors: Array<ValidateSyntaxError> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidateSyntaxError {
    #[wasm_bindgen(readonly)]
    pub message: String,
    #[wasm_bindgen(readonly)]
    pub offset: usize,
    #[wasm_bindgen(readonly)]
    pub length: usize,
}

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateSyntaxResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    #[wasm_bindgen(readonly)]
    pub policies: Option<usize>,
    #[wasm_bindgen(readonly)]
    pub templates: Option<usize>,
    errors: Option<Vec<ValidateSyntaxError>>,
}

#[wasm_bindgen]
impl ValidateSyntaxResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        if let Some(errors) = &self.errors {
            let arr = js_sys::Array::new_with_length(errors.len() as u32);
            for (i, e) in errors.iter().enumerate() {
                let vse = js_sys::Object::new();
                js_sys::Reflect::set(
                    &vse,
                    &JsValue::from_str("message"),
                    &JsValue::from_str(&e.clone().message),
                )
                .unwrap();
                js_sys::Reflect::set(
                    &vse,
                    &JsValue::from_str("offset"),
                    &JsValue::from_f64(e.offset as f64),
                )
                .unwrap();
                js_sys::Reflect::set(
                    &vse,
                    &JsValue::from_str("length"),
                    &JsValue::from_f64(e.length as f64),
                )
                .unwrap();

                arr.set(i as u32, JsValue::from(vse));
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
        Err(parse_errs) => {
            // let syntax_errs: Vec<_> = parse_errs
            //     .into_iter()
            //     .flat_map(|parse_err| {
            //         parse_err
            //             .labels()
            //             .into_iter()
            //             .flatten()
            //             .map(|labeled_span| {
            //                 let message = match labeled_span.label() {
            //                     None => parse_err.to_string(),
            //                     Some(label) => format!("{}\n{}", parse_err.to_string(), label),
            //                 };
            //                 ValidateSyntaxError {
            //                     message,
            //                     length: labeled_span.len(),
            //                     offset: labeled_span.offset(),
            //                 }
            //             }).collect::<Vec<_>>()
            //     })
            //     .collect();
            let mut syntax_errs = Vec::new();
            parse_errs.into_iter().for_each(|parse_err| {
                match parse_err.labels().into_iter().count() == 0 {
                    true => {
                        syntax_errs.push(ValidateSyntaxError {
                            message: parse_err.to_string(),
                            length: 0,
                            offset: 0,
                        });
                    }
                    false => {
                        parse_err.labels().into_iter().for_each(|labels| {
                            labels.into_iter().for_each(|labeled_span| {
                                let message = match labeled_span.label() {
                                    None => parse_err.to_string(),
                                    Some(msg) => format!("{}\n{}", parse_err, msg),
                                };
                                syntax_errs.push(ValidateSyntaxError {
                                    message: message,
                                    length: labeled_span.len(),
                                    offset: labeled_span.offset(),
                                });
                            });
                        });
                    }
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
