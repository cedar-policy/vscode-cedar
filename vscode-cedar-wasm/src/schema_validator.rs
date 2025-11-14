// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy::SchemaWarning;
use cedar_policy_core::extensions::Extensions;
use cedar_policy_core::validator::{CedarSchemaError, ValidatorSchema};
use miette::Diagnostic;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::validate_message::{convert_messages_to_js_array, ValidateMessage};

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_SCHEMA_RESULT: &'static str = r#"
export class ValidateSchemaResult {
  free(): void;
  readonly success: boolean;
  readonly warnings: Array<ValidateMessage> | undefined;
  readonly errors: Array<ValidateMessage> | undefined;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateSchemaResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    warnings: Option<Vec<ValidateMessage>>,
    errors: Option<Vec<ValidateMessage>>,
}

fn messages(messages: &Option<Vec<ValidateMessage>>) -> Option<js_sys::Array> {
    messages.as_ref().map(convert_messages_to_js_array)
}

#[wasm_bindgen]
impl ValidateSchemaResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> Option<js_sys::Array> {
        messages(&self.errors)
    }
    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> Option<js_sys::Array> {
        messages(&self.warnings)
    }
}

fn format_diagnostic_message<T: Diagnostic>(diagnostic: &T) -> String {
    diagnostic.help().map_or_else(
        || format!("{diagnostic}"),
        |help| format!("{diagnostic}\n{help}"),
    )
}

#[wasm_bindgen(js_name = validateSchemaJSON)]
pub fn validate_schema_json(input_schema_str: &str) -> ValidateSchemaResult {
    let result =
        match ValidatorSchema::from_json_str(&input_schema_str, Extensions::all_available()) {
            Ok(_schema) => ValidateSchemaResult {
                success: true,
                warnings: None,
                errors: None,
            },
            Err(e) => {
                let (offset, length) = if let Some(labels) = e.labels() {
                    if let Some(label) = labels.into_iter().next() {
                        (label.offset(), label.len())
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                };

                ValidateSchemaResult {
                    success: false,
                    warnings: None,
                    errors: Some(vec![ValidateMessage {
                        message: format_diagnostic_message(&e),
                        offset,
                        length,
                    }]),
                }
            }
        };
    result
}

#[wasm_bindgen(js_name = validateSchemaCedar)]
pub fn validate_schema_cedar(input_schema_str: &str) -> ValidateSchemaResult {
    let result =
        match ValidatorSchema::from_cedarschema_str(&input_schema_str, Extensions::all_available())
        {
            Ok(_schema) => {
                let mut warnings_vec = Vec::new();
                for warning in _schema.1.into_iter() {
                    match HasOffsetLength::offset_length(&warning) {
                        offset_length => warnings_vec.push(ValidateMessage {
                            message: format_diagnostic_message(&warning),
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
                    offset_length => ValidateMessage {
                        message: format_diagnostic_message(&e),
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
        let zero_offset = OffsetLength {
            offset: 0,
            length: 0,
        };

        let labels = match self {
            SchemaWarning::ShadowsEntity(warning, ..) => warning.labels(),
            SchemaWarning::ShadowsBuiltin(warning, ..) => warning.labels(),
            _ => return zero_offset,
        };

        labels
            .and_then(|labels| labels.into_iter().next())
            .map(|label| OffsetLength {
                offset: label.offset(),
                length: label.len(),
            })
            .unwrap_or(zero_offset)
    }
}

impl HasOffsetLength for CedarSchemaError {
    fn offset_length(&self) -> OffsetLength {
        let zero_offset = OffsetLength {
            offset: 0,
            length: 0,
        };

        let labels = match self {
            CedarSchemaError::Parsing(parse_error) => parse_error.labels(),
            CedarSchemaError::Schema(schema_error) => schema_error.labels(),
            _ => return zero_offset,
        };

        labels
            .and_then(|labels| labels.into_iter().next())
            .map(|label| OffsetLength {
                offset: label.offset(),
                length: label.len(),
            })
            .unwrap_or(zero_offset)
    }
}
