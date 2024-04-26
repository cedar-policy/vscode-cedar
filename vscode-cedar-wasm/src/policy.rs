// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{Policy, Template};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const EXPORT_POLICY_RESULT: &'static str = r#"
export class ExportPolicyResult {
  free(): void;
  readonly success: boolean;
  readonly json: string | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPolicyResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    pub json: Option<String>,
}

#[wasm_bindgen(js_name = exportPolicy)]
pub fn export_policy(input_policy_str: &str) -> ExportPolicyResult {
    let Ok(policy) = Policy::parse(None, input_policy_str) else {
        return ExportPolicyResult {
            success: false,
            json: None,
        };
    };

    let Ok(json) = policy.to_json() else {
        return ExportPolicyResult {
            success: false,
            json: None,
        };
    };

    ExportPolicyResult {
        success: true,
        json: Some(json.to_string()),
    }
}

#[wasm_bindgen(js_name = exportPolicyTemplate)]
pub fn export_policy_template(input_policy_template_str: &str) -> ExportPolicyResult {
    let Ok(policy) = Template::parse(None, input_policy_template_str) else {
        return ExportPolicyResult {
            success: false,
            json: None,
        };
    };

    let Ok(json) = policy.to_json() else {
        return ExportPolicyResult {
            success: false,
            json: None,
        };
    };

    ExportPolicyResult {
        success: true,
        json: Some(json.to_string()),
    }
}
