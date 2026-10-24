// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from 'assert';

import { cedarCLIDetail, detectCedarCLI } from '../../about';

suite('Cedar About Suite', () => {
  test('cedar --version becomes an About detail', () => {
    assert.equal(
      cedarCLIDetail('cedar-policy-cli 4.13.0\n'),
      'Cedar CLI: 4.13.0',
    );
  });

  test('unexpected cedar --version output is ignored', () => {
    assert.equal(cedarCLIDetail(''), undefined);
    assert.equal(cedarCLIDetail('cedar-policy-cli\n'), undefined);
  });

  // the Cedar CLI is optional, so either outcome is valid
  test('detect the Cedar CLI', async () => {
    const cedarCLI = await detectCedarCLI();

    if (cedarCLI !== undefined) {
      assert.match(cedarCLI, /^Cedar CLI: \S+$/);
    }
  });
});
