// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{Entities, Schema};
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::validate_message::{convert_messages_to_js_array, ValidateMessage};

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_ENTITIES_RESULT: &'static str = r#"
export class ValidateEntitiesResult {
  free(): void;
  readonly success: boolean;
  readonly errors: Array<ValidateMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateEntitiesResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    errors: Option<Vec<ValidateMessage>>,
}

#[wasm_bindgen]
impl ValidateEntitiesResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        self.errors.as_ref().map(convert_messages_to_js_array)
    }
}

fn create_error_result(e: impl std::fmt::Display) -> ValidateEntitiesResult {
    ValidateEntitiesResult {
        success: false,
        errors: Some(vec![ValidateMessage {
            message: e.to_string(),
            offset: 0,
            length: 0,
        }]),
    }
}

#[wasm_bindgen(js_name = validateEntitiesSchemaJSON)]
pub fn validate_entities_schema_json(
    input_schema_str: &str,
    input_entities_str: &str,
) -> ValidateEntitiesResult {
    let schema = match Schema::from_json_str(&input_schema_str) {
        Ok(schema) => Some(schema),
        Err(e) => {
            return create_error_result(e);
        }
    };
    let result = match Entities::from_json_str(input_entities_str, schema.as_ref()) {
        Ok(_entities) => ValidateEntitiesResult {
            success: true,
            errors: None,
        },
        Err(e) => {
            let diagnostic: &dyn Diagnostic = &e;
            let validate_errs = match diagnostic.source() {
                Some(source) => vec![ValidateMessage {
                    message: String::from(&format!("{}: {}", e, source)),
                    offset: 0,
                    length: 0,
                }],
                None => vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }],
            };
            ValidateEntitiesResult {
                success: false,
                errors: Some(validate_errs),
            }
        }
    };
    result
}

#[wasm_bindgen(js_name = validateEntitiesSchemaCedar)]
pub fn validate_entities_schema_cedar(
    input_schema_str: &str,
    input_entities_str: &str,
) -> ValidateEntitiesResult {
    let schema = match Schema::from_cedarschema_str(&input_schema_str) {
        Ok(schema) => Some(schema),
        Err(e) => {
            return create_error_result(e);
        }
    };
    let result = match Entities::from_json_str(input_entities_str, Some(&schema.unwrap().0)) {
        Ok(_entities) => ValidateEntitiesResult {
            success: true,
            errors: None,
        },
        Err(e) => {
            let diagnostic: &dyn Diagnostic = &e;
            let validate_errs = match diagnostic.source() {
                Some(source) => vec![ValidateMessage {
                    message: String::from(&format!("{}: {}", e, source)),
                    offset: 0,
                    length: 0,
                }],
                None => vec![ValidateMessage {
                    message: String::from(&format!("{e}")),
                    offset: 0,
                    length: 0,
                }],
            };
            ValidateEntitiesResult {
                success: false,
                errors: Some(validate_errs),
            }
        }
    };
    result
}

#[cfg(test)]
mod test {
    use super::*;
    use std::fs;
    use std::sync::OnceLock;

    static SCHEMA_STR: OnceLock<String> = OnceLock::new();

    fn get_schema() -> &'static String {
        SCHEMA_STR.get_or_init(|| {
            fs::read_to_string("../testdata/entityattr/cedarschema.json")
                .expect("Failed to read cedarschema file")
        })
    }

    #[test]
    fn validate_entities_attrs_nested() {
        let entities_str =
            fs::read_to_string("../testdata/entityattr/expected2.cedarentities.json")
                .expect("Failed to read entities file");
        let result = validate_entities_schema_json(get_schema(), &entities_str);
        assert!(matches!(
            result,
            ValidateEntitiesResult {
                success: false,
                errors: _,
            }
        ));
    }
}
