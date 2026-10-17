// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use std::collections::HashMap;
use std::str::FromStr;

use cedar_policy::{
    Authorizer, Context, Decision, Entities, EntityUid, PolicyId, PolicySet, Request, Schema,
    SlotId,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const IS_AUTHORIZED_RESULT: &'static str = r#"
export class IsAuthorizedResult {
  free(): void;
  readonly success: boolean;
  readonly decision?: string;
  readonly reasons: Array<string>;
  readonly errors: Array<string>;
}"#;

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct IsAuthorizedResult {
    /// `false` when the request could not be evaluated at all (bad schema,
    /// policies, entities, or request).  A `deny` decision is still a success.
    #[wasm_bindgen(readonly)]
    pub success: bool,
    /// `allow` or `deny`, or `undefined` when `success` is `false`
    #[wasm_bindgen(readonly)]
    pub decision: Option<String>,
    reasons: Vec<String>,
    errors: Vec<String>,
}

#[wasm_bindgen]
impl IsAuthorizedResult {
    /// policy ids which determined the decision
    #[wasm_bindgen(getter)]
    pub fn reasons(&self) -> js_sys::Array {
        convert_strings_to_js_array(&self.reasons)
    }

    /// authorization (evaluation) errors, or the reason `success` is `false`
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> js_sys::Array {
        convert_strings_to_js_array(&self.errors)
    }
}

fn convert_strings_to_js_array(strings: &Vec<String>) -> js_sys::Array {
    let arr = js_sys::Array::new_with_length(strings.len() as u32);
    for (i, s) in strings.iter().enumerate() {
        arr.set(i as u32, JsValue::from_str(s));
    }
    arr
}

fn create_error_result(e: impl std::fmt::Display) -> IsAuthorizedResult {
    IsAuthorizedResult {
        success: false,
        decision: None,
        reasons: Vec::new(),
        errors: vec![e.to_string()],
    }
}

#[derive(Debug, Deserialize)]
struct TemplateLink {
    template_id: String,
    link_id: String,
    args: HashMap<String, String>,
}

/// The Cedar SDK assigns generated ids (`policy0`, `policy1`, ...) when parsing
/// a policy set from text.  Rename each policy and template using its `@id`
/// annotation (when present) so authorization reasons report the same ids
/// displayed elsewhere in the extension.
fn apply_id_annotations(policy_set: &PolicySet) -> Result<PolicySet, String> {
    let mut renamed = PolicySet::new();

    for template in policy_set.templates() {
        let template = match template.annotation("id") {
            Some(id) => template.new_id(PolicyId::from_str(id).map_err(|e| e.to_string())?),
            None => template.clone(),
        };
        renamed.add_template(template).map_err(|e| e.to_string())?;
    }

    for policy in policy_set.policies() {
        let policy = match policy.annotation("id") {
            Some(id) => policy.new_id(PolicyId::from_str(id).map_err(|e| e.to_string())?),
            None => policy.clone(),
        };
        renamed.add(policy).map_err(|e| e.to_string())?;
    }

    Ok(renamed)
}

fn link_templates(policy_set: &mut PolicySet, template_links_str: &str) -> Result<(), String> {
    if template_links_str.trim().is_empty() {
        return Ok(());
    }

    let links: Vec<TemplateLink> =
        serde_json::from_str(template_links_str).map_err(|e| e.to_string())?;

    for link in links {
        let mut vals: HashMap<SlotId, EntityUid> = HashMap::new();
        for (slot, uid) in &link.args {
            let slot_id = match slot.as_str() {
                "?principal" => SlotId::principal(),
                "?resource" => SlotId::resource(),
                _ => return Err(format!("unknown template slot `{slot}`")),
            };
            vals.insert(
                slot_id,
                EntityUid::from_str(uid).map_err(|e| e.to_string())?,
            );
        }
        policy_set
            .link(
                PolicyId::from_str(&link.template_id).map_err(|e| e.to_string())?,
                PolicyId::from_str(&link.link_id).map_err(|e| e.to_string())?,
                vals,
            )
            .map_err(|e| format!("unable to link `{}`: {e}", link.link_id))?;
    }

    Ok(())
}

fn parse_schema(input_schema_str: &str, schema_is_json: bool) -> Result<Option<Schema>, String> {
    if input_schema_str.trim().is_empty() {
        return Ok(None);
    }

    if schema_is_json {
        Schema::from_json_str(input_schema_str)
            .map(Some)
            .map_err(|e| e.to_string())
    } else {
        Schema::from_cedarschema_str(input_schema_str)
            .map(|(schema, _warnings)| Some(schema))
            .map_err(|e| e.to_string())
    }
}

fn build_request(input_request_str: &str, schema: Option<&Schema>) -> Result<Request, String> {
    #[derive(Deserialize)]
    struct RequestJson {
        principal: String,
        action: String,
        resource: String,
        #[serde(default)]
        context: serde_json::Value,
    }

    let request: RequestJson =
        serde_json::from_str(input_request_str).map_err(|e| e.to_string())?;

    let principal = EntityUid::from_str(&request.principal).map_err(|e| e.to_string())?;
    let action = EntityUid::from_str(&request.action).map_err(|e| e.to_string())?;
    let resource = EntityUid::from_str(&request.resource).map_err(|e| e.to_string())?;

    let context_json = if request.context.is_null() {
        serde_json::json!({})
    } else {
        request.context
    };
    let context = Context::from_json_value(context_json, schema.map(|s| (s, &action)))
        .map_err(|e| e.to_string())?;

    Request::new(principal, action, resource, context, schema).map_err(|e| e.to_string())
}

/// Evaluate a single authorization request.
///
/// `input_schema_str` and `input_template_links_str` may be empty.  Policy ids
/// are taken from `@id` annotations when present, and template linked policies
/// use the `link_id` from `input_template_links_str`.
#[wasm_bindgen(js_name = isAuthorized)]
pub fn is_authorized(
    input_schema_str: &str,
    schema_is_json: bool,
    input_policies_str: &str,
    input_template_links_str: &str,
    input_entities_str: &str,
    input_request_str: &str,
) -> IsAuthorizedResult {
    let schema = match parse_schema(input_schema_str, schema_is_json) {
        Ok(schema) => schema,
        Err(e) => return create_error_result(e),
    };

    let parsed = match PolicySet::from_str(input_policies_str) {
        Ok(policy_set) => policy_set,
        Err(e) => return create_error_result(e),
    };
    let mut policy_set = match apply_id_annotations(&parsed) {
        Ok(policy_set) => policy_set,
        Err(e) => return create_error_result(e),
    };
    if let Err(e) = link_templates(&mut policy_set, input_template_links_str) {
        return create_error_result(e);
    }

    let entities_str = if input_entities_str.trim().is_empty() {
        "[]"
    } else {
        input_entities_str
    };
    let entities = match Entities::from_json_str(entities_str, schema.as_ref()) {
        Ok(entities) => entities,
        Err(e) => return create_error_result(e),
    };

    let request = match build_request(input_request_str, schema.as_ref()) {
        Ok(request) => request,
        Err(e) => return create_error_result(e),
    };

    let response = Authorizer::new().is_authorized(&request, &policy_set, &entities);

    IsAuthorizedResult {
        success: true,
        decision: Some(
            match response.decision() {
                Decision::Allow => "allow",
                Decision::Deny => "deny",
            }
            .to_string(),
        ),
        reasons: response
            .diagnostics()
            .reason()
            .map(|id| id.to_string())
            .collect(),
        errors: response
            .diagnostics()
            .errors()
            .map(|e| e.to_string())
            .collect(),
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use std::fs;

    fn read_photoapp(filename: &str) -> String {
        fs::read_to_string(format!("../testdata/photoapp/{filename}"))
            .unwrap_or_else(|_| panic!("Failed to read {filename}"))
    }

    #[derive(Deserialize)]
    struct CedarTest {
        name: String,
        request: serde_json::Value,
        entities: Option<serde_json::Value>,
        decision: String,
        #[serde(default)]
        reason: Vec<String>,
        #[serde(default)]
        num_errors: usize,
    }

    #[test]
    fn photoapp_cedartests() {
        let schema = read_photoapp("photoapp.cedarschema");
        let policies = read_photoapp("policies.cedar");
        let links = read_photoapp("cedartemplatelinks.json");
        let fallback_entities = read_photoapp("cedarentities.json");
        let tests: Vec<CedarTest> =
            serde_json::from_str(&read_photoapp("cedartests.json")).expect("invalid cedartests");

        assert_eq!(tests.len(), 17);

        for test in tests {
            let entities = match &test.entities {
                Some(entities) => entities.to_string(),
                None => fallback_entities.clone(),
            };
            let result = is_authorized(
                &schema,
                false,
                &policies,
                &links,
                &entities,
                &test.request.to_string(),
            );
            assert!(result.success, "{}: {:?}", test.name, result.errors);
            assert_eq!(
                result.decision.as_deref(),
                Some(test.decision.as_str()),
                "{}",
                test.name
            );
            let mut reasons = result.reasons.clone();
            reasons.sort();
            let mut expected = test.reason.clone();
            expected.sort();
            assert_eq!(reasons, expected, "{}", test.name);
            assert_eq!(result.errors.len(), test.num_errors, "{}", test.name);
        }
    }

    #[test]
    fn photoapp_no_schema() {
        let policies = read_photoapp("policies.cedar");
        let links = read_photoapp("cedartemplatelinks.json");
        let entities = read_photoapp("cedarentities.json");
        let request = r#"{
            "principal": "PhotoApp::User::\"JaneDoe\"",
            "action": "PhotoApp::Action::\"viewPhoto\"",
            "resource": "PhotoApp::Photo::\"JaneDoe.jpg\"",
            "context": {}
        }"#;

        let result = is_authorized("", false, &policies, &links, entities.as_str(), request);
        assert!(result.success, "{:?}", result.errors);
        assert_eq!(result.decision.as_deref(), Some("allow"));
    }

    #[test]
    fn invalid_request() {
        let result = is_authorized("", false, "", "", "[]", r#"{"principal": "oops"}"#);
        assert!(!result.success);
        assert_eq!(result.errors.len(), 1);
    }
}
