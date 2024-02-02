// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use wasm_bindgen::prelude::*;
mod utils;
mod format;
mod syntax_validator;
mod policy_validator;
mod schema_validator;
mod entities_validator;
mod policy;


#[wasm_bindgen(js_name = "getCedarVersion")]
pub fn get_cedar_version() -> String {
    std::env!("CEDAR_VERSION").to_string()
}