// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const VALIDATE_ENTITIES_RESULT: &'static str = r#"
export class ValidateMessage {
  readonly message: string;
  readonly length: number;
  readonly offset: number;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidateMessage {
    #[wasm_bindgen(readonly)]
    pub message: String,
    #[wasm_bindgen(readonly)]
    pub offset: usize,
    #[wasm_bindgen(readonly)]
    pub length: usize,
}

pub fn convert_messages_to_js_array(messages: &Vec<ValidateMessage>) -> js_sys::Array {
    let arr = js_sys::Array::new_with_length(messages.len() as u32);
    
    for (i, e) in messages.iter().enumerate() {
        let vm = js_sys::Object::new();
        js_sys::Reflect::set(
            &vm,
            &JsValue::from_str("message"),
            &JsValue::from_str(&e.clone().message),
        )
        .unwrap();
        js_sys::Reflect::set(
            &vm,
            &JsValue::from_str("offset"),
            &JsValue::from_f64(e.offset as f64),
        )
        .unwrap();
        js_sys::Reflect::set(
            &vm,
            &JsValue::from_str("length"),
            &JsValue::from_f64(e.length as f64),
        )
        .unwrap();

        arr.set(i as u32, JsValue::from(vm));
    }
    
    arr
}
