// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { before } from 'mocha';

import { cedarCLICommandLine } from '../../cli';

const openTestdata = async (
  folder: string,
  filename: string,
): Promise<vscode.TextDocument> =>
  vscode.workspace.openTextDocument(
    path.join(process.cwd(), 'testdata', folder, filename),
  );

suite('Cedar CLI Suite', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('cedar-policy.vscode-cedar');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('validate a Cedar policy file', async () => {
    const doc = await openTestdata('photoapp', 'policies.cedar');

    assert.equal(
      await cedarCLICommandLine('validate', doc),
      'cedar validate -s photoapp.cedarschema -p policies.cedar -k cedartemplatelinks.json',
    );
  });

  test('run a Cedar tests file', async () => {
    const doc = await openTestdata('photoapp', 'cedartests.json');

    assert.equal(
      await cedarCLICommandLine('run-tests', doc),
      'cedar run-tests --tests cedartests.json -p policies.cedar -k cedartemplatelinks.json -s photoapp.cedarschema',
    );
  });

  test('check a Cedar schema parses', async () => {
    const doc = await openTestdata('photoapp', 'photoapp.cedarschema');

    assert.equal(
      await cedarCLICommandLine('check-parse-schema', doc),
      'cedar check-parse -s photoapp.cedarschema',
    );
  });

  test('check a Cedar schema JSON file parses', async () => {
    const doc = await openTestdata('entityattr', 'cedarschema.json');

    assert.equal(
      await cedarCLICommandLine('check-parse-schema', doc),
      'cedar check-parse -s cedarschema.json --schema-format json',
    );
  });

  test('check Cedar entities parse', async () => {
    const doc = await openTestdata('entityattr', 'exist.cedarentities.json');

    assert.equal(
      await cedarCLICommandLine('check-parse-entities', doc),
      'cedar check-parse --entities exist.cedarentities.json -s cedarschema.json --schema-format json',
    );
  });

  test('authorize a Cedar request', async () => {
    const doc = await openTestdata('photoapp', 'cedarauth.json');

    assert.equal(
      await cedarCLICommandLine('authorize', doc),
      'cedar authorize --request-json cedarauth.json --entities cedarentities.json -p policies.cedar -k cedartemplatelinks.json -s photoapp.cedarschema --verbose',
    );
  });
});
