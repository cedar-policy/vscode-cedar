// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use cedar_policy_formatter::{policies_str_to_pretty, Config};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const FORMAT_POLICIES: &'static str = r#"
export class FormatPoliciesResult {
  free(): void;
  readonly error?: string;
  readonly policy?: string;
  readonly success: boolean;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct FormatPoliciesResult {
    pub success: bool,
    pub policy: Option<String>,
    pub error: Option<String>,
}

#[wasm_bindgen(js_name = formatPolicies)]
pub fn format_policies(policies_str: &str, line_width: i32, indent_width: i32) -> FormatPoliciesResult {
    let line_width: Result<usize, _> = line_width.try_into();
    let indent_width: Result<isize, _> = indent_width.try_into();
    if line_width.is_err() || indent_width.is_err() {
        return FormatPoliciesResult {
          success: false,
          policy: None,
          error: Some(String::from("Input size error (line_width or indent_width).")),
      }
    }
    let config = Config {
        line_width: line_width.unwrap(),
        indent_width: indent_width.unwrap(),
    };
    match policies_str_to_pretty(policies_str, &config) {
        Ok(prettified_policy) => FormatPoliciesResult {
          success: true,
          policy: Some(prettified_policy),
          error: None,
        },
        Err(err) => FormatPoliciesResult {
          success: false,
          policy: None,
          error: Some(String::from(&format!("Input error: {err}"))),
      }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_format_policies() {
        let policy = r#"permit(principal, action == Action::"view", resource in Albums::"gangsta rap") when {principal.is_gangsta == true};"#;
        let expected = "permit (\n    principal,\n    action == Action::\"view\",\n    resource in Albums::\"gangsta rap\"\n)\nwhen { principal.is_gangsta == true };";
        assert_eq!(format_policies(policy, 80, 4).policy, Some(expected.to_string()));
    }
}