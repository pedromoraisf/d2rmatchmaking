import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBash } from '../lib/gate-rules.mjs';
import { RULE_MODULES } from './rule-modules.mjs';

function fakeCtx(files = {}) {
  return {
    root: '/repo',
    readFile: (rel) => (rel in files ? files[rel] : null),
    isTracked: () => false,
    currentBranch: () => 'feat/x',
    git: () => '',
    modules: RULE_MODULES,
  };
}
const d = (r) => r?.decision ?? 'allow';

const BAD = JSON.stringify([
  { label: 'integration proof', proof: 'cargo nextest run --workspace -E "test(x)"' },
]);
const GOOD = JSON.stringify([{ label: 'unit proof', proof: 'cargo nextest run -p d2rmm-agent-core --lib' }]);
const ctx = fakeCtx({
  '.specs/features/f/bad.json': BAD,
  '.specs/features/f/good.json': GOOD,
  '.specs/features/f/broken.json': '{',
});

const SCRIPTS = 'python3 .claude/skills/tlc-spec-driven/scripts';
const mutate = (file) => `${SCRIPTS}/mutate.py --spec ${file}`;
const proofs = (file) =>
  `node scripts/attempt.mjs run --feature f --step proofs -- "${SCRIPTS}/check_proofs.py f --mutations ${file}"`;

test('ADR 026: mutate.py and check_proofs.py --mutations refuse a spec with a non-unit proof', () => {
  const direct = checkBash(mutate('.specs/features/f/bad.json'), ctx);
  assert.equal(d(direct), 'deny');
  assert.match(direct.reason, /unit tests only/);
  assert.equal(d(checkBash(proofs('.specs/features/f/bad.json'), ctx)), 'deny');
  assert.equal(d(checkBash(mutate('/repo/.specs/features/f/bad.json'), ctx)), 'deny');
});

test('ADR 026: an unreadable-as-JSON spec or a stdin spec cannot be checked, so it is refused', () => {
  assert.equal(d(checkBash(mutate('.specs/features/f/broken.json'), ctx)), 'deny');
  assert.equal(d(checkBash(`${SCRIPTS}/mutate.py --spec -`, ctx)), 'deny');
});

test('ADR 026: a spec made only of unit proofs runs, and so does a spec the gate cannot find', () => {
  assert.equal(d(checkBash(mutate('.specs/features/f/good.json'), ctx)), 'allow');
  assert.equal(d(checkBash(proofs('.specs/features/f/good.json'), ctx)), 'allow');
  assert.equal(d(checkBash(mutate('.specs/features/f/missing.json'), ctx)), 'allow');
});
