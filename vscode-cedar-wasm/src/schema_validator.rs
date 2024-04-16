// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::{HumanSchemaError, Schema, SchemaWarning};
use cedar_policy_validator::human_schema::parser::HumanSyntaxParseErrors;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_SCHEMA_RESULT: &'static str = r#"
export class ValidateSchemaMessage {
  readonly message: string;
  readonly length: number;
  readonly offset: number;
}
export class ValidateSchemaResult {
  free(): void;
  readonly success: boolean;
  readonly warnings: Array<ValidateSchemaMessage> | undefined;
  readonly errors: Array<ValidateSchemaMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidateSchemaMessage {
    #[wasm_bindgen(readonly)]
    pub message: String,
    #[wasm_bindgen(readonly)]
    pub offset: usize,
    #[wasm_bindgen(readonly)]
    pub length: usize,
}

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateSchemaResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    warnings: Option<Vec<ValidateSchemaMessage>>,
    errors: Option<Vec<ValidateSchemaMessage>>,
}

fn messages(messages: &Option<Vec<ValidateSchemaMessage>>) -> Option<js_sys::Array> {
    if let Some(messages) = messages {
        let arr = js_sys::Array::new_with_length(messages.len() as u32);
        for (i, e) in messages.iter().enumerate() {
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

#[wasm_bindgen]
impl ValidateSchemaResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        return messages(&self.errors);
    }
    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> Option<js_sys::Array> {
        return messages(&self.warnings);
    }
}

#[wasm_bindgen(js_name = validateSchema)]
pub fn validate_schema(input_schema_str: &str) -> ValidateSchemaResult {
    let result = match Schema::from_str(&input_schema_str) {
        Ok(_schema) => ValidateSchemaResult {
            success: true,
            warnings: None,
            errors: None,
        },
        Err(e) => ValidateSchemaResult {
            success: false,
            warnings: None,
            errors: Some(vec![ValidateSchemaMessage {
                message: String::from(&format!("{e}")),
                offset: 0,
                length: 0,
            }]),
        },
    };
    result
}

#[wasm_bindgen(js_name = validateSchemaNatural)]
pub fn validate_schema_natural(input_schema_str: &str) -> ValidateSchemaResult {
    let result = match Schema::from_str_natural(&input_schema_str) {
        Ok(_schema) => {
            let mut warnings_vec = Vec::new();
            for warning in _schema.1.into_iter() {
                match HasOffsetLength::offset_length(&warning) {
                    offset_length => warnings_vec.push(ValidateSchemaMessage {
                        message: String::from(&format!("{warning}")),
                        offset: offset_length.offset,
                        length: offset_length.length,
                    }),
                };
            }
            ValidateSchemaResult {
                success: true,
                warnings: Some(warnings_vec),
                errors: None,
            }
        }
        Err(e) => {
            let error = match HasOffsetLength::offset_length(&e) {
                offset_length => ValidateSchemaMessage {
                    message: String::from(&format!("{e}")),
                    offset: offset_length.offset,
                    length: offset_length.length,
                },
            };
            ValidateSchemaResult {
                success: false,
                warnings: None,
                errors: Some(vec![error]),
            }
        }
    };
    result
}

struct OffsetLength {
    offset: usize,
    length: usize,
}

trait HasOffsetLength {
    fn offset_length(&self) -> OffsetLength;
}

impl HasOffsetLength for SchemaWarning {
    fn offset_length(&self) -> OffsetLength {
        match self {
            SchemaWarning::ShadowsEntity { entity_loc, .. } => OffsetLength {
                offset: entity_loc.start(),
                length: entity_loc.end() - entity_loc.start(),
            },
            SchemaWarning::ShadowsBuiltin { loc, .. } => OffsetLength {
                offset: loc.start(),
                length: loc.end() - loc.start(),
            },
            SchemaWarning::UsesBuiltinNamespace { loc, .. } => OffsetLength {
                offset: loc.start(),
                length: loc.end() - loc.start(),
            },
        }
    }
}

impl HasOffsetLength for HumanSchemaError {
    fn offset_length(&self) -> OffsetLength {
        let zero_offset = OffsetLength {
            offset: 0,
            length: 0,
        };
        match self {
            HumanSchemaError::ParseError(parse_error) => match parse_error {
                HumanSyntaxParseErrors::NaturalSyntaxError(nse) => {
                    let first = nse.iter().into_iter().next();
                    match first {
                        Some(item) => OffsetLength {
                            offset: item.primary_source_span().offset(),
                            length: item.primary_source_span().len(),
                        },
                        None => zero_offset,
                    }
                }
                HumanSyntaxParseErrors::JsonError(_) => zero_offset,
            },
            HumanSchemaError::Core(_) => zero_offset,
            HumanSchemaError::Io(_) => zero_offset,
        }
    }
}
