// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use std::collections::BTreeSet;

use cedar_policy::{Policy, RequestEnv, Schema, Template};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const REQUEST_ENVS_RESULT: &'static str = r#"
export class RequestEnvsResult {
  free(): void;
  readonly success: boolean;
  readonly principals: Array<string>;
  readonly actions: Array<string>;
  readonly resources: Array<string>;
}"#;

/// The distinct principal types, action ids, and resource types of the request
/// environments a policy applies to, each sorted
#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct RequestEnvsResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    pub principals: Vec<String>,
    pub actions: Vec<String>,
    pub resources: Vec<String>,
}

#[wasm_bindgen(js_name = getRequestEnvsSchemaJSON)]
pub fn get_request_envs_schema_json(
    input_schema_str: &str,
    input_policy_str: &str,
) -> RequestEnvsResult {
    match Schema::from_json_str(input_schema_str) {
        Ok(schema) => get_request_envs(&schema, input_policy_str),
        Err(_) => RequestEnvsResult::default(),
    }
}

#[wasm_bindgen(js_name = getRequestEnvsSchemaCedar)]
pub fn get_request_envs_schema_cedar(
    input_schema_str: &str,
    input_policy_str: &str,
) -> RequestEnvsResult {
    match Schema::from_cedarschema_str(input_schema_str) {
        Ok((schema, _)) => get_request_envs(&schema, input_policy_str),
        Err(_) => RequestEnvsResult::default(),
    }
}

/// The request environments for which a single policy, or template with
/// slots, is not trivially false, according to the schema.  The policy body is
/// typechecked too, so an environment where the body has a type error is
/// excluded.
fn get_request_envs(schema: &Schema, input_policy_str: &str) -> RequestEnvsResult {
    let envs: Vec<RequestEnv> = if let Ok(policy) = Policy::parse(None, input_policy_str) {
        policy.get_valid_request_envs(schema).collect()
    } else if let Ok(template) = Template::parse(None, input_policy_str) {
        template.get_valid_request_envs(schema).collect()
    } else {
        return RequestEnvsResult::default();
    };

    let mut principals = BTreeSet::new();
    let mut actions = BTreeSet::new();
    let mut resources = BTreeSet::new();
    for env in envs {
        principals.insert(env.principal().to_string());
        actions.insert(env.action().to_string());
        resources.insert(env.resource().to_string());
    }

    RequestEnvsResult {
        success: true,
        principals: principals.into_iter().collect(),
        actions: actions.into_iter().collect(),
        resources: resources.into_iter().collect(),
    }
}

#[cfg(test)]
mod test {
    use super::*;

    const SCHEMA: &str = r#"
namespace NS {
  entity E;
  entity E1 in [E] { p1: String };
  entity E2 in [E] { p1: Long };
  entity R;
  entity R1 in [R] { p1: String };
  entity R2 in [R] { p1: Long };
  action "as";
  action a in ["as"] appliesTo { principal: [E1, E2], resource: [R1, R2] };
  action a1 in ["as"] appliesTo { principal: E1, resource: R1 };
  action a2 in ["as"] appliesTo { principal: E2, resource: R2 };
}
"#;

    fn envs(policy: &str) -> RequestEnvsResult {
        get_request_envs_schema_cedar(SCHEMA, policy)
    }

    fn strs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn unconstrained() {
        let r = envs("permit(principal, action, resource);");
        assert!(r.success);
        assert_eq!(r.principals, strs(&["NS::E1", "NS::E2"]));
        assert_eq!(
            r.actions,
            strs(&[
                r#"NS::Action::"a""#,
                r#"NS::Action::"a1""#,
                r#"NS::Action::"a2""#
            ])
        );
        assert_eq!(r.resources, strs(&["NS::R1", "NS::R2"]));
    }

    #[test]
    fn action_eq() {
        let r = envs(r#"permit(principal, action == NS::Action::"a1", resource);"#);
        assert_eq!(r.principals, strs(&["NS::E1"]));
        assert_eq!(r.actions, strs(&[r#"NS::Action::"a1""#]));
        assert_eq!(r.resources, strs(&["NS::R1"]));
    }

    #[test]
    fn action_in_list() {
        let r =
            envs(r#"permit(principal, action in [NS::Action::"a1", NS::Action::"a2"], resource);"#);
        assert_eq!(r.principals, strs(&["NS::E1", "NS::E2"]));
        assert_eq!(
            r.actions,
            strs(&[r#"NS::Action::"a1""#, r#"NS::Action::"a2""#])
        );
    }

    #[test]
    fn action_in_group() {
        let r = envs(r#"permit(principal, action in NS::Action::"as", resource);"#);
        assert_eq!(r.actions.len(), 3);
    }

    #[test]
    fn principal_is() {
        let r = envs("permit(principal is NS::E2, action, resource);");
        assert_eq!(r.principals, strs(&["NS::E2"]));
        assert_eq!(
            r.actions,
            strs(&[r#"NS::Action::"a""#, r#"NS::Action::"a2""#])
        );
        assert_eq!(r.resources, strs(&["NS::R1", "NS::R2"]));
    }

    #[test]
    fn principal_and_resource_correlated() {
        let r = envs("permit(principal is NS::E1, action, resource is NS::R2);");
        assert_eq!(r.actions, strs(&[r#"NS::Action::"a""#]));
    }

    #[test]
    fn body_narrows() {
        let r = envs("permit(principal, action, resource) when { principal is NS::E1 };");
        assert_eq!(r.principals, strs(&["NS::E1"]));
        assert_eq!(r.resources, strs(&["NS::R1", "NS::R2"]));
    }

    #[test]
    fn body_type_error_excludes_env() {
        // p1 is a String on E1 and a Long on E2
        let r = envs(r#"permit(principal, action, resource) when { principal.p1 == "x" };"#);
        assert_eq!(r.principals, strs(&["NS::E1"]));
    }

    #[test]
    fn impossible() {
        let r = envs("permit(principal is NS::E, action, resource);");
        assert!(r.success);
        assert!(r.principals.is_empty());
        assert!(r.actions.is_empty());
        assert!(r.resources.is_empty());
    }

    #[test]
    fn template_slots() {
        let r = envs(
            r#"permit(principal == ?principal, action == NS::Action::"a2", resource in ?resource);"#,
        );
        assert!(r.success);
        assert_eq!(r.principals, strs(&["NS::E2"]));
        assert_eq!(r.resources, strs(&["NS::R2"]));
    }

    #[test]
    fn invalid_policy() {
        let r = envs("permit(principal, action, resource");
        assert!(!r.success);
        assert!(r.principals.is_empty());
    }

    #[test]
    fn invalid_schema() {
        let r = get_request_envs_schema_cedar("entity", "permit(principal, action, resource);");
        assert!(!r.success);
        let r = get_request_envs_schema_json("{", "permit(principal, action, resource);");
        assert!(!r.success);
    }

    #[test]
    fn json_schema() {
        let schema = r#"{ "": {
          "entityTypes": { "User": {}, "Photo": {} },
          "actions": { "view": { "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Photo"] } } }
        } }"#;
        let r = get_request_envs_schema_json(schema, "permit(principal, action, resource);");
        assert!(r.success);
        assert_eq!(r.principals, strs(&["User"]));
        assert_eq!(r.actions, strs(&[r#"Action::"view""#]));
        assert_eq!(r.resources, strs(&["Photo"]));
    }
}
