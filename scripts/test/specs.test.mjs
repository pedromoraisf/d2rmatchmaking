import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpecs } from '../lib/specs.mjs';

function repo(files) {
  return {
    read: (rel) => (rel in files ? files[rel] : null),
    list: (dir) => [
      ...new Set(
        Object.keys(files)
          .filter((f) => f.startsWith(`${dir}/`))
          .map((f) => f.slice(dir.length + 1).split('/')[0]),
      ),
    ],
  };
}

test('the active phase needs a brief', () => {
  let r = repo({ '.specs/phases/ACTIVE': 'F1\n' });
  assert.match(checkSpecs(r.read, r.list)[0], /brief\.md is missing/);
  r = repo({ '.specs/phases/ACTIVE': 'F1\n', '.specs/phases/F1/brief.md': '# F1' });
  assert.deepEqual(checkSpecs(r.read, r.list), []);
  r = repo({ '.specs/phases/ACTIVE': 'phase one' });
  assert.match(checkSpecs(r.read, r.list)[0], /phase id/);
});

test('a spec without its acceptance scenarios fails', () => {
  let r = repo({ '.specs/features/queues/spec.md': '# s' });
  assert.match(checkSpecs(r.read, r.list)[0], /acceptance\.feature is missing/);
  r = repo({
    '.specs/features/queues/spec.md': '# s',
    '.specs/features/queues/acceptance.feature': 'Feature: q',
  });
  assert.deepEqual(checkSpecs(r.read, r.list), []);
});
