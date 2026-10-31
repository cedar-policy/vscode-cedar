// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

use cedar_policy_core::extensions::Extensions;
use cedar_policy_core::validator::json_schema::Fragment;
use cedar_policy_core::validator::{Linker, RawName, ValidatorSchema, ValidatorSchemaFragment};
use miette::{Diagnostic, SourceSpan};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const LINK_SCHEMAS_RESULT: &'static str = r#"
export class LinkSchemaMessage {
  readonly message: string;
  readonly offset: number;
  readonly length: number;
  readonly index: number;
}
export class LinkSchemasResult {
  free(): void;
  readonly success: boolean;
  readonly mode: 'merge' | 'link';
  readonly schema?: string;
  readonly complete: boolean;
  readonly externalEntityTypes: Array<string>;
  readonly externalActions: Array<string>;
  readonly errors: Array<LinkSchemaMessage>;
  readonly warnings: Array<LinkSchemaMessage>;
}"#;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkSchemaMessage {
    pub message: String,
    pub offset: usize,
    pub length: usize,
    // index of the schema the message is located in, or -1 for the whole set
    pub index: i32,
}

#[wasm_bindgen(getter_with_clone, skip_typescript)]
#[derive(Debug, Serialize, Deserialize)]
pub struct LinkSchemasResult {
    #[wasm_bindgen(readonly)]
    pub success: bool,
    #[wasm_bindgen(readonly)]
    pub mode: String,
    #[wasm_bindgen(readonly)]
    pub schema: Option<String>,
    #[wasm_bindgen(readonly)]
    pub complete: bool,
    #[wasm_bindgen(readonly, js_name = externalEntityTypes)]
    pub external_entity_types: Vec<String>,
    #[wasm_bindgen(readonly, js_name = externalActions)]
    pub external_actions: Vec<String>,
    errors: Vec<LinkSchemaMessage>,
    warnings: Vec<LinkSchemaMessage>,
}

fn convert_messages_to_js_array(messages: &Vec<LinkSchemaMessage>) -> js_sys::Array {
    let arr = js_sys::Array::new_with_length(messages.len() as u32);
    for (i, m) in messages.iter().enumerate() {
        let vm = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&vm, &"message".into(), &m.message.as_str().into());
        let _ = js_sys::Reflect::set(&vm, &"offset".into(), &(m.offset as f64).into());
        let _ = js_sys::Reflect::set(&vm, &"length".into(), &(m.length as f64).into());
        let _ = js_sys::Reflect::set(&vm, &"index".into(), &(m.index as f64).into());
        arr.set(i as u32, JsValue::from(vm));
    }
    arr
}

#[wasm_bindgen]
impl LinkSchemasResult {
    #[wasm_bindgen(getter)]
    pub fn errors(&self) -> js_sys::Array {
        convert_messages_to_js_array(&self.errors)
    }
    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> js_sys::Array {
        convert_messages_to_js_array(&self.warnings)
    }
}

fn format_diagnostic_message<T: Diagnostic + ?Sized>(diagnostic: &T) -> String {
    diagnostic.help().map_or_else(
        || format!("{diagnostic}"),
        |help| format!("{diagnostic}\n{help}"),
    )
}

/*
 * Locate a diagnostic in one of the schema sources.  Errors found while
 * combining the schemas carry the source text of the declaration they label,
 * so compare that source text with each input to find which schema it is in.
 */
fn locate<T: Diagnostic + ?Sized>(
    diagnostic: &T,
    sources: &[String],
    default_index: i32,
) -> LinkSchemaMessage {
    let message = format_diagnostic_message(diagnostic);
    let label = diagnostic
        .labels()
        .and_then(|mut labels| labels.next())
        .map(|label| (label.offset(), label.len()));

    if default_index < 0 {
        if let (Some((offset, length)), Some(source_code)) = (label, diagnostic.source_code()) {
            for (index, source) in sources.iter().enumerate() {
                let span = SourceSpan::new(0.into(), source.len());
                if let Ok(contents) = source_code.read_span(&span, 0, 0) {
                    if contents.data() == source.as_bytes() {
                        return LinkSchemaMessage {
                            message,
                            offset,
                            length,
                            index: index as i32,
                        };
                    }
                }
            }
        }
        return LinkSchemaMessage {
            message,
            offset: 0,
            length: 0,
            index: -1,
        };
    }

    let (offset, length) = label.unwrap_or((0, 0));
    LinkSchemaMessage {
        message,
        offset,
        length,
        index: default_index,
    }
}

fn has_external(fragment: &Fragment<RawName>) -> bool {
    fragment.0.values().any(|namespace| {
        namespace.entity_types.values().any(|ety| ety.external)
            || namespace.actions.values().any(|action| action.external)
    })
}

fn failure(
    mode: &str,
    errors: Vec<LinkSchemaMessage>,
    warnings: Vec<LinkSchemaMessage>,
) -> LinkSchemasResult {
    LinkSchemasResult {
        success: false,
        mode: mode.to_string(),
        schema: None,
        complete: false,
        external_entity_types: Vec::new(),
        external_actions: Vec::new(),
        errors,
        warnings,
    }
}

/*
 * Combine several schemas, each in the Cedar ("cedar") or JSON ("json")
 * format, into one JSON schema.  When any schema declares an `external` entity
 * type or action, each schema must stand alone and they are linked, resolving
 * each `external` declaration against a definition of the same name.
 * Otherwise the schemas are merged as fragments of one schema, which may refer
 * to each other's entity and common types.
 */
#[wasm_bindgen(js_name = linkSchemas)]
pub fn link_schemas(sources: Vec<String>, formats: Vec<String>) -> LinkSchemasResult {
    let extensions = Extensions::all_available();
    let mut errors: Vec<LinkSchemaMessage> = Vec::new();
    let mut warnings: Vec<LinkSchemaMessage> = Vec::new();

    let mut fragments: Vec<Fragment<RawName>> = Vec::new();
    for (i, source) in sources.iter().enumerate() {
        let index = i as i32;
        let parsed = if formats.get(i).map(String::as_str) == Some("json") {
            Fragment::from_json_str(source).map_err(|e| locate(&e, &sources, index))
        } else {
            match Fragment::from_cedarschema_str(source, extensions) {
                Ok((fragment, schema_warnings)) => {
                    for w in schema_warnings {
                        warnings.push(locate(&w, &sources, index));
                    }
                    Ok(fragment)
                }
                Err(e) => Err(locate(&e, &sources, index)),
            }
        };
        match parsed {
            Ok(fragment) => fragments.push(fragment),
            // every schema which fails to parse is reported, not just the first
            Err(message) => errors.push(message),
        }
    }

    let mode = if fragments.iter().any(has_external) {
        "link"
    } else {
        "merge"
    };
    if !errors.is_empty() {
        return failure(mode, errors, warnings);
    }

    let schema = if mode == "link" {
        let mut schemas = Vec::new();
        for (i, fragment) in fragments.into_iter().enumerate() {
            match ValidatorSchemaFragment::from_schema_fragment(fragment)
                .and_then(|f| ValidatorSchema::from_schema_fragments([f], extensions))
            {
                Ok(schema) => schemas.push(schema),
                Err(e) => errors.push(locate(&e, &sources, i as i32)),
            }
        }
        if !errors.is_empty() {
            return failure(mode, errors, warnings);
        }
        Linker::new(schemas, extensions)
            .link()
            .map_err(|e| locate(&e, &sources, -1))
    } else {
        let mut validator_fragments = Vec::new();
        for (i, fragment) in fragments.into_iter().enumerate() {
            match ValidatorSchemaFragment::from_schema_fragment(fragment) {
                Ok(f) => validator_fragments.push(f),
                Err(e) => errors.push(locate(&e, &sources, i as i32)),
            }
        }
        if !errors.is_empty() {
            return failure(mode, errors, warnings);
        }
        ValidatorSchema::from_schema_fragments(validator_fragments, extensions)
            .map_err(|e| locate(&e, &sources, -1))
    };

    let schema = match schema {
        Ok(schema) => schema,
        Err(message) => return failure(mode, vec![message], warnings),
    };

    // resolve each `EntityOrCommon` type to an entity or common type, the same
    // as translating a Cedar schema to JSON
    let json = match schema.to_json_schema().and_then(|fragment| {
        fragment
            .to_internal_name_fragment_with_resolved_types()
            .map_err(|e| e.to_string())
            .and_then(|resolved| serde_json::to_string(&resolved).map_err(|e| e.to_string()))
    }) {
        Ok(json) => json,
        Err(e) => {
            return failure(
                mode,
                vec![LinkSchemaMessage {
                    message: e,
                    offset: 0,
                    length: 0,
                    index: -1,
                }],
                warnings,
            )
        }
    };

    let mut external_entity_types: Vec<String> = schema
        .entity_types()
        .filter(|ety| ety.is_external())
        .map(|ety| ety.name().to_string())
        .collect();
    external_entity_types.sort();
    let mut external_actions: Vec<String> = schema
        .action_ids()
        .filter(|action| action.is_external())
        .map(|action| action.name().to_string())
        .collect();
    external_actions.sort();

    LinkSchemasResult {
        success: true,
        mode: mode.to_string(),
        schema: Some(json),
        complete: schema.is_complete(),
        external_entity_types,
        external_actions,
        errors,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(sources: &[&str]) -> LinkSchemasResult {
        link_schemas(
            sources.iter().map(|s| s.to_string()).collect(),
            sources.iter().map(|_| "cedar".to_string()).collect(),
        )
    }

    #[test]
    fn merges_fragments_without_external() {
        let result = link(&[
            "entity User;",
            "entity Document { owner: User }; action view appliesTo { principal: User, resource: Document };",
        ]);
        assert!(result.success, "{:?}", result.errors);
        assert_eq!(result.mode, "merge");
        assert!(result.complete);
    }

    #[test]
    fn links_external_declarations() {
        let result = link(&[
            "entity User;",
            "external entity User; entity Document { owner: User };",
        ]);
        assert!(result.success, "{:?}", result.errors);
        assert_eq!(result.mode, "link");
        assert!(result.complete);
    }

    #[test]
    fn resolves_entity_or_common_types() {
        let result = link(&[
            "namespace App { entity User; }",
            "namespace App { external entity User; entity Doc { owner: User, tags: Set<User> }; }",
        ]);
        assert!(result.success, "{:?}", result.errors);
        let schema = result.schema.unwrap();
        assert!(!schema.contains("EntityOrCommon"), "{schema}");
        assert!(
            schema.contains(r#"{"type":"Entity","name":"App::User"}"#),
            "{schema}"
        );
    }

    #[test]
    fn reports_unresolved_external() {
        let result = link(&["external entity User; entity Document { owner: User };"]);
        assert!(result.success);
        assert!(!result.complete);
        assert_eq!(result.external_entity_types, vec!["User".to_string()]);
    }

    #[test]
    fn locates_duplicate_in_merge() {
        let result = link(&["entity User;", "entity Document;\nentity User;"]);
        assert!(!result.success);
        assert_eq!(result.errors.len(), 1);
        println!("{:?}", result.errors);
    }

    #[test]
    fn locates_parse_error() {
        let result = link(&["entity User;", "entity Document"]);
        assert!(!result.success);
        assert_eq!(result.errors[0].index, 1);
    }

    #[test]
    fn locates_standalone_error_in_link() {
        let result = link(&[
            "external entity User;",
            "entity Document { owner: Missing };",
        ]);
        assert!(!result.success);
        assert_eq!(result.errors[0].index, 1);
    }
}
