// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as cedar from 'vscode-cedar-wasm';

suite('Cedar WASM format Suite', () => {
  test('formatPolicies', async () => {
    const rawPolicy = `permit (
  principal,
    action,
       resource
);`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      rawPolicy,
      80,
      4
    );
    assert.equal(result.success, true);
    assert.equal(result.policy, 'permit (principal, action, resource);');
    result.free();
  });

  test('formatPolicies', async () => {
    const rawPolicy = `forbid (principal, action, resource) 
    when { principal has tenant && resource has tenant && principal.tenant != resource.tenant};`;
    const formattedPolicy = `forbid (principal, action, resource)
when
{
    principal has tenant &&
    resource has tenant &&
    principal.tenant != resource.tenant
};`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      rawPolicy,
      80,
      4
    );
    assert.equal(result.success, true);

    assert.equal(result.policy, formattedPolicy);
    result.free();
  });

  test('formatPolicies single line with trailing comment', async () => {
    const formattedPolicy = `forbid (principal, action, resource); // trailing comment
`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      formattedPolicy,
      80,
      4
    );
    assert.equal(result.success, true);
    assert.equal(result.policy, formattedPolicy);
    result.free();
  });

  test('formatPolicies single line with trailing comment line', async () => {
    const formattedPolicy = `forbid (principal, action, resource);
// trailing comment line
`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      formattedPolicy,
      80,
      4
    );
    assert.equal(result.success, true);
    assert.equal(result.policy, formattedPolicy);
    result.free();
  });

  test('formatPolicies single line with clause trailing comment', async () => {
    const formattedPolicy = `forbid (principal, action, resource)
when
{
    principal == resource && // keeps comment
    principal.x == resource.x // loses comment
};`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      formattedPolicy,
      80,
      4
    );
    assert.equal(result.success, true);
    assert.equal(result.policy, formattedPolicy);
    result.free();
  });

  test('formatPolicies with comments', async () => {
    const formattedPolicy = `forbid (principal, action, resource) // effect comment
when
{
    principal has tenant && // line 1 comment
    resource has tenant && // line 2 comment
    principal.tenant != resource.tenant // line 3 comment
};`;
    const result: cedar.FormatPoliciesResult = cedar.formatPolicies(
      formattedPolicy,
      80,
      4
    );
    //console.log(result.policy);
    assert.equal(result.success, true);
    assert.equal(result.policy, formattedPolicy);
    result.free();
  });
});

suite('Cedar WASM validate Suite', () => {
  test('validate_syntax_passes_1_policy', async () => {
    const policy = 'permit(principal, action, resource);';
    const result: cedar.ValidateSyntaxResult = cedar.validateSyntax(policy);
    assert.equal(result.success, true);
    assert.equal(result.policies, 1);
    result.free();
  });

  test('validate_syntax_passes_multi_policy', async () => {
    const policy =
      'forbid(principal, action, resource); permit(principal == User::"alice", action == Action::"view", resource in Albums::"alice_albums");';
    const result: cedar.ValidateSyntaxResult = cedar.validateSyntax(policy);
    assert.equal(result.success, true);
    assert.equal(result.policies, 2);
    result.free();
  });

  test('validate_syntax_returns_validation_errors_when_expected_1_policy', async () => {
    const policy = 'permit(2pac, action, resource)';
    const result: cedar.ValidateSyntaxResult = cedar.validateSyntax(policy);
    assert.equal(result.success, false);
    result.free();
  });

  test('validate_syntax_returns_validation_errors_when_expected_multi_policy', async () => {
    const policy =
      'forbid(principal, action, resource);permit(2pac, action, resource)';
    const result: cedar.ValidateSyntaxResult = cedar.validateSyntax(policy);
    assert.equal(result.success, false);
    //console.log(result.errors);
    result.free();
  });

  test('validate_schema_passes', async () => {
    const schema = `{
      "" : {
        "entityTypes": {
          "User": {}
        },
        "actions": {
          "view" : {
            "appliesTo": {
              "principalTypes": ["User"],
              "resourceTypes": ["User"]
            }
          }
        }
      }
    }`;
    const result: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
    assert.equal(result.success, true);
    result.free();
  });

  test('validate_schema_fails', async () => {
    const schema = `{
      "" : {
        "entityTypes": {
          "User": {}
        },
        "actions": {
          "view" : {
            "appliesTo": {
              "principalTypes": ["Usr"],
              "resourceTypes": ["User"]
            }
          }
        }
      }
    }`;
    const result: cedar.ValidateSchemaResult = cedar.validateSchema(schema);
    assert.equal(result.success, false);
    result.free();
  });

  test('validate_policy_fails', async () => {
    const schema = '{ "entityTypes": [], "actions": [] }';
    const policy = 'permit(principal, action, resource);';
    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    assert.equal(result.success, false);
    //console.log(result.errors);
    result.free();
  });

  test('validate_policy_passes', async () => {
    const schema = `{
      "" : {
        "entityTypes": {
          "User": {}
        },
        "actions": {
          "view" : {
            "appliesTo": {
              "principalTypes": ["User"],
              "resourceTypes": ["User"]
            }
          }
        }
      }
    }`;
    const policy = `permit(principal == User::"Kevin", action == Action::"view", resource == User::"Kevin");`;
    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    assert.equal(result.success, true);

    result.free();
  });

  test('validate_entity_passes', async () => {
    const schema = `{
      "" : {
        "entityTypes": {
          "User": {}
        },
        "actions": {}
      }
    }`;
    const entities = `[
      {
        "uid": "User::\\"JaneDoe\\"",
        "parents": [],
        "attrs": {}
      }
    ]`;
    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      entities,
      schema
    );
    assert.equal(result.success, true);

    result.free();
  });

  test('validate_entity_attrs', async () => {
    const schema = `{
      "" : {
        "entityTypes": {
          "User": {}
        },
        "actions": {}
      }
    }`;
    const entities = `[
      {
        "uid": "User::\\"JaneDoe\\"",
        "parents": [],
        "attrs": {
          "tags": ["private"]
        }
      }
    ]`;
    const result: cedar.ValidateEntitiesResult = cedar.validateEntities(
      entities,
      schema
    );
    assert.equal(result.success, false);
    // `entities deserialization error: Attribute "tags" on User::"JaneDoe" shouldn't exist according to the schema`

    result.free();
  });

  test('validate_policy_bad_extensions', async () => {
    const schema = `{
  "unittest": {
    "entityTypes": {
      "User": {}
    },
    "actions": {
      "doAction" : {
        "appliesTo": {
          "context": {
            "type": "Record",
            "attributes": {
              "userIP": {
                "type": "String"
              }
            }
          }
        }
      }
    }
  }
}`;
    const policy = `forbid (principal, action, resource)
when {
    ip("ab.ab.ab.ab").isLoopback() ||
    ip(context.usrIP).isLoopback() ||
    decimal("0.12345").lessThan(decimal("0.1234"))
};`;
    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    // console.log(result.errors);
    assert.equal(result.success, false);
    assert.equal(result.errors?.length, 4);
    result.free();
  });

  test('validate_policy_if_then_else', async () => {
    const schema = `{
    "My::Name::Space": {
      "entityTypes": {
        "User": {
          "memberOfTypes": ["UserGroup"],
          "shape": {
            "type": "Record",
            "attributes": {
              "department": { "type": "String" },
              "jobLevel": {
                "type": "Long"
              }
            }
          }
        },
        "UserGroup": {},
        "Photo": {
          "memberOfTypes": ["Album"],
          "shape": {
            "type": "Record",
            "attributes": {
              "private": { "type": "Boolean" },
              "account": {
                "type": "Entity",
                "name": "Account"
              }
            }
          }
        },
        "Album": {
          "memberOfTypes": ["Album"],
          "shape": {
            "type": "Record",
            "attributes": {
              "private": { "type": "Boolean" },
              "account": {
                "type": "Entity",
                "name": "Account"
              }
            }
          }
        },
        "Account": {
          "memberOfTypes": [],
          "shape": {
            "type": "Record",
            "attributes": {
              "owner": {
                "type": "Entity",
  
                "name": "User"
              },
              "admins": {
                "required": false,
                "type": "Set",
                "element": {
                  "type": "Entity",
                  "name": "User"
                }
              }
            }
          }
        }
      },
      "actions": {
        "photoAction": {
          "appliesTo": {
            "principalTypes": [],
            "resourceTypes": [],
            "context": {
              "type": "Record",
              "attributes": {}
            }
          }
        },
        "viewPhoto": {
          "appliesTo": {
            "principalTypes": ["User"],
            "resourceTypes": ["Photo"],
            "context": {
              "type": "Record",
              "attributes": {
                "authenticated": { "type": "Boolean" }
              }
            }
          }
        },
        "listAlbums": {
          "appliesTo": {
            "principalTypes": ["User"],
            "resourceTypes": ["Account"],
            "context": {
              "type": "Record",
              "attributes": {
                "authenticated": {
                  "type": "Boolean"
                }
              }
            }
          }
        },
        "uploadPhoto": {
          "appliesTo": {
            "principalTypes": ["User"],
            "resourceTypes": ["Album"],
            "context": {
              "type": "Record",
              "attributes": {
                "authenticated": { "type": "Boolean" },
                "photo": {
                  "type": "Record",
                  "attributes": {
                    "file_size": { "type": "Long" },
                    "file_type": {
                      "type": "String"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
    const policy = `permit (principal, action, resource)
when {
  if context.tier == "free" then resource.sizeInBytes < 5000000 else resource.sizeInBytes < 15000000
};`;
    const result: cedar.ValidatePolicyResult = cedar.validatePolicy(
      schema,
      policy
    );
    // console.log(result.errors);
    assert.equal(result.success, false);
    assert.equal(result.errors?.length, 6);
    result.free();
  });
});
