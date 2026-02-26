// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::SchemaFragment;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const TRANSLATE_SCHEMA: &'static str = r#"
export class TranslateSchemaResult {
  free(): void;
  readonly success: boolean;
  readonly schema?: string;
  readonly error?: string;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateSchemaResult {
    pub success: bool,
    pub schema: Option<String>,
    pub error: Option<String>,
}

#[wasm_bindgen(js_name = translateSchemaFromJSON)]
pub fn translate_schema_from_json(json_src: &str) -> TranslateSchemaResult {
    match SchemaFragment::from_json_str(json_src) {
        Ok(fragment) => match fragment.to_cedarschema() {
            Ok(human) => TranslateSchemaResult {
                success: true,
                schema: Some(human),
                error: None,
            },
            Err(err) => TranslateSchemaResult {
                success: false,
                schema: None,
                error: Some(format!("Translate error: {err}")),
            },
        },
        Err(err) => TranslateSchemaResult {
            success: false,
            schema: None,
            error: Some(format!("Translate error: {err}")),
        },
    }
}

#[wasm_bindgen(js_name = translateSchemaToJSON)]
pub fn translate_schema_to_json(cedar_src: &str) -> TranslateSchemaResult {
    match cedar_policy::ffi::schema_to_json_with_resolved_types(cedar_src) {
        cedar_policy::ffi::SchemaToJsonWithResolvedTypesAnswer::Success { json, warnings: _ } => TranslateSchemaResult {
            success: true,
            schema: Some(json.to_string()),
            error: None,
        },
        cedar_policy::ffi::SchemaToJsonWithResolvedTypesAnswer::Failure { errors } => TranslateSchemaResult {
            success: false,
            schema: None,
            error: Some(errors.iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>().join("; ")),
        },
    }
}
