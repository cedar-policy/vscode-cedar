// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "setPanicHook")]
pub fn set_panic_hook() {
  // When the `console_error_panic_hook` feature is enabled, we can call the
  // `set_panic_hook` function at least once during initialization, and then
  // we will get better error messages if our code ever panics.
  //
  // For more details see
  // https://github.com/rustwasm/console_error_panic_hook#readme
  #[cfg(feature = "console_error_panic_hook")]
  console_error_panic_hook::set_once();
}

#[wasm_bindgen(js_name = "getCedarVersion")]
pub fn get_cedar_version() -> String {
    std::env!("CEDAR_VERSION").to_string()
}