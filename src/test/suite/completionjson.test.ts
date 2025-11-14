// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { before } from 'mocha';
import { snippetify } from '../../completionjson';
import { parseCedarSchemaDoc, SchemaCacheItem } from '../../parser';

suite('snippetify Suite', () => {
  let schema: SchemaCacheItem;
  before(async () => {
    const schemaDoc = await vscode.workspace.openTextDocument(
      path.join(process.cwd(), 'testdata', 'datatypes', 'cedarschema')
    );
    schema = parseCedarSchemaDoc(schemaDoc);
  });

  const snippitForEntityType = (entityType: string): string => {
    let attrs = '';
    let tabstop = 2;
    const completions = schema.completions;
    ({ value: attrs, tabstop } = snippetify(
      schema,
      completions[entityType],
      2,
      [entityType],
      2
    ));

    const snippet = `
  "uid": { "type": "${entityType}", "id": "$1" },
  "attrs": ${attrs},
  "parents": [$${tabstop}]
`;

    return snippet;
  };

  test('snippetify User', async () => {
    const actual = snippitForEntityType('NS1::User');
    const expected = `
  "uid": { "type": "NS1::User", "id": "$1" },
  "attrs": {
    "delegate": { "type": "NS1::User", "id": "$2" },
    "name": "$3"
  },
  "parents": [$4]
`;

    assert.equal(actual, expected);
  });

  test('snippetify Group', async () => {
    const actual = snippitForEntityType('NS1::Group');
    const expected = `
  "uid": { "type": "NS1::Group", "id": "$1" },
  "attrs": {
    "name": "$2",
    "owners": [$3]
  },
  "parents": [$4]
`;

    assert.equal(actual, expected);
  });

  test('snippetify EP', async () => {
    const actual = snippitForEntityType('NS1::EP');
    const expected = `
  "uid": { "type": "NS1::EP", "id": "$1" },
  "attrs": {
    "b": $\{2|false,true|},
    "l": $\{3:0},
    "p": {
      "b": $\{4|false,true|},
      "l": $\{5:0},
      "s": "$6"
    },
    "s": "$7"
  },
  "parents": [$8]
`;

    assert.equal(actual, expected);
  });

  test('snippetify ES', async () => {
    const actual = snippitForEntityType('NS1::ES');
    const expected = `
  "uid": { "type": "NS1::ES", "id": "$1" },
  "attrs": {
    "bs": [$2],
    "ls": [$3],
    "ps": [$4],
    "s": {
      "bs": [$5],
      "ls": [$6],
      "ss": [$7]
    },
    "ss": [$8],
    "sss": [$9]
  },
  "parents": [$10]
`;

    assert.equal(actual, expected);
  });

  test('snippetify EF', async () => {
    const actual = snippitForEntityType('NS1::EF');
    const expected = `
  "uid": { "type": "NS1::EF", "id": "$1" },
  "attrs": {
    "da": { "fn": "datetime", "arg": "$\{2:2024-10-15T11:35:00Z}" },
    "de": { "fn": "decimal", "arg": "$\{3:12345.6789}" },
    "du": { "fn": "duration", "arg": "$\{4:1d2h3m4s5ms}" },
    "f": {
      "da": { "fn": "datetime", "arg": "$\{5:2024-10-15T11:35:00Z}" },
      "de": { "fn": "decimal", "arg": "$\{6:12345.6789}" },
      "du": { "fn": "duration", "arg": "$\{7:1d2h3m4s5ms}" },
      "ip": { "fn": "ip", "arg": "$\{8:127.0.0.1}" }
    },
    "ip": { "fn": "ip", "arg": "$\{9:127.0.0.1}" }
  },
  "parents": [$10]
`;

    assert.equal(actual, expected);
  });

  test('snippetify EB', async () => {
    const actual = snippitForEntityType('NS1::EB');
    const expected = `
  "uid": { "type": "NS1::EB", "id": "$1" },
  "attrs": {
    "b": {
      "f": {
        "da": { "fn": "datetime", "arg": "$\{2:2024-10-15T11:35:00Z}" },
        "de": { "fn": "decimal", "arg": "$\{3:12345.6789}" },
        "du": { "fn": "duration", "arg": "$\{4:1d2h3m4s5ms}" },
        "ip": { "fn": "ip", "arg": "$\{5:127.0.0.1}" }
      },
      "p": {
        "b": $\{6|false,true|},
        "l": $\{7:0},
        "s": "$8"
      }
    }
  },
  "parents": [$9]
`;

    assert.equal(actual, expected);
  });
});
