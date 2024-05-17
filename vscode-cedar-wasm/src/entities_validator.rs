// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{Entities, Schema};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_ENTITIES_RESULT: &'static str = r#"
export class ValidateEntitiesResult {
  free(): void;
  readonly success: boolean;
  readonly errors: Array<string> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateEntitiesResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    errors: Option<Vec<String>>,
}

#[wasm_bindgen]
impl ValidateEntitiesResult {
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

#[wasm_bindgen(js_name = validateEntities)]
pub fn validate_entities(
    input_entities_str: &str,
    input_schema_str: &str,
) -> ValidateEntitiesResult {
    let schema = match Schema::from_str(&input_schema_str) {
        Ok(schema) => Some(schema),
        Err(e) => {
            return ValidateEntitiesResult {
                success: false,
                errors: Some(vec![String::from(&format!("{e}"))]),
            }
        }
    };
    let result = match Entities::from_json_str(input_entities_str, schema.as_ref()) {
        Ok(_entities) => ValidateEntitiesResult {
            success: true,
            errors: None,
        },
        Err(e) => ValidateEntitiesResult {
            success: false,
            errors: Some(vec![String::from(&format!("{e}"))]),
        },
    };
    result
}
