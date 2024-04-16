// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy_formatter::{policies_str_to_pretty, Config};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const FORMAT_POLICIES: &'static str = r#"
export class FormatPoliciesResult {
  free(): void;
  readonly success: boolean;
  readonly policy?: string;
  readonly error?: string;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct FormatPoliciesResult {
    pub success: bool,
    pub policy: Option<String>,
    pub error: Option<String>,
}

#[wasm_bindgen(js_name = formatPolicies)]
pub fn format_policies(policies_str: &str, line_width: usize, indent_width: isize) -> FormatPoliciesResult {
    let config = Config {
      line_width: line_width,
      indent_width: indent_width,
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
          error: Some(String::from(&format!("Format error: {err}"))),
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