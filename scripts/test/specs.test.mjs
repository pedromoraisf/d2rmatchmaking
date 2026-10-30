import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpecs } from '../lib/specs.mjs';

const WORDS = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const brief = (scopes = '- [x] specs-and-tasks: ok') =>
  `# F0\n\n| harness-foundation | Complex |\n\n## Delegation\n${scopes}\n\n**Approved**: 2026-11-02 - user: "${WORDS}"\n`;

function repo(files) {
  return {
    read: (rel) => (rel in files ? files[rel] : null),
    list: (dir) => [...new Set(Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1).split('/')[0]))],
  };
}
const base = {
  '.specs/STATE.md': '# State\n',
  '.specs/phases/ACTIVE': 'F0\n',
  '.specs/phases/F0/brief.md': brief(),
  '.specs/phases/F0/decisions.md': '# Decisions\n',
};
const approved = `**Approved**: 2026-11-03 - user: "${WORDS}" (delegated via .specs/phases/F0/brief.md)`;

test('a delegated approval that quotes the kickoff passes', () => {
  const r = repo({ ...base, '.specs/features/harness-foundation/spec.md': `# s\n${approved}\n` });
  assert.deepEqual(checkSpecs(r.read, r.list), []);
});

test('paraphrased, undelegated or unlisted approvals fail', () => {
  let r = repo({ ...base, '.specs/features/harness-foundation/spec.md': approved.replace(WORDS, 'ok') });
  assert.equal(checkSpecs(r.read, r.list).length, 1);
  r = repo({ ...base, '.specs/phases/F0/brief.md': brief('- [ ] specs-and-tasks: no'), '.specs/features/harness-foundation/spec.md': approved });
  assert.match(checkSpecs(r.read, r.list)[0], /does not delegate/);
  r = repo({ ...base, '.specs/features/other-feature/spec.md': approved });
  assert.match(checkSpecs(r.read, r.list)[0], /not listed/);
});

test('assumed decisions must be queued for the phase review', () => {
  const r = repo({ ...base, '.specs/STATE.md': '# State\n### AD-022 — Use X (assumed)\n' });
  assert.match(checkSpecs(r.read, r.list)[0], /AD-022/);
  const ok = repo({ ...base, '.specs/STATE.md': '### AD-022 — Use X (assumed)\n', '.specs/phases/F0/decisions.md': '- AD-022' });
  assert.deepEqual(checkSpecs(ok.read, ok.list), []);
});

test('missing state and phase files are reported', () => {
  const r = repo({ '.specs/phases/ACTIVE': 'F0' });
  assert.equal(checkSpecs(r.read, r.list).length, 3);
});
