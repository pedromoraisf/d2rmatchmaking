import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREBUILT_VARIABLE, useBuiltImages } from '../../load/lib/prebuilt-images.mjs';

const both = { api: true, k6: true };

test('skips the build only with the flag 1 and both images present (UPK-06)', () => {
  assert.equal(useBuiltImages({ [PREBUILT_VARIABLE]: '1' }, both), true);
  assert.equal(useBuiltImages({ [PREBUILT_VARIABLE]: '1' }, { api: true, k6: false }), false);
  assert.equal(useBuiltImages({ [PREBUILT_VARIABLE]: '1' }, { api: false, k6: true }), false);
  assert.equal(useBuiltImages({}, both), false);
  for (const value of ['', '0', 'true', 'yes', '1 ']) {
    assert.equal(useBuiltImages({ [PREBUILT_VARIABLE]: value }, both), false, `"${value}" is not the flag`);
  }
});

test('the variable is named as the nightly sets it', () => {
  assert.equal(PREBUILT_VARIABLE, 'LOAD_IMAGES_PREBUILT');
});
