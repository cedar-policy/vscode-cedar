// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::SchemaFragment;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
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

#[wasm_bindgen(js_name = translateSchemaToHuman)]
pub fn translate_schema_to_human(json_src: &str) -> TranslateSchemaResult {
    return match SchemaFragment::from_str(json_src.as_ref()) {
        Ok(fragment) => {
            return match fragment.as_natural() {
                Ok(human) => TranslateSchemaResult {
                    success: true,
                    schema: Some(human),
                    error: None
                },
                Err(err) => TranslateSchemaResult {
                    success: false,
                    schema: None,
                    error: Some(String::from(&format!("Translate error: {err}"))),
                }
            }
        },
        Err(err) => TranslateSchemaResult {
            success: false,
            schema: None,
            error: Some(String::from(&format!("Translate error: {err}"))),
        },
    }
    // TranslateSchemaResult {
    //     success: false,
    //     schema: None,
    //     error: Some(String::from("Translate error")),
    // }
}

#[wasm_bindgen(js_name = translateSchemaToJSON)]
pub fn translate_schema_to_json(natural_src: &str) -> TranslateSchemaResult {
    return match SchemaFragment::from_str_natural(natural_src.as_ref()) {
        Ok((fragment, _)) => {
            return match fragment.as_json_string() {
                Ok(json) => TranslateSchemaResult {
                    success: true,
                    schema: Some(json),
                    error: None,
                },
                Err(err) => TranslateSchemaResult {
                    success: false,
                    schema: None,
                    error: Some(String::from(&format!("Translate error: {err}"))),
                },
            };
        }
        Err(err) => TranslateSchemaResult {
            success: false,
            schema: None,
            error: Some(String::from(&format!("Translate error: {err}"))),
        },
    }

}
