import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefFeatures, derivePhaseState, featureState, taskCount } from '../lib/phase-state.mjs';

const brief = (approved = true) => `# F1

## Features

| Feature | Size   | Depends on | Parallel | Covers |
| ------- | ------ | ---------- | -------- | ------ |
| alpha   | Medium | —          | no       | FR-01  |
| beta    | Large  | alpha      | no       | FR-02  |

${approved ? '**Approved**: 2026-11-10 - user: "ok"' : '<!-- **Approved**: <date> -->'}
`;

test('reads the features table', () => {
  assert.deepEqual(briefFeatures(brief()), [
    { feature: 'alpha', size: 'Medium', dependsOn: [] },
    { feature: 'beta', size: 'Large', dependsOn: ['alpha'] },
  ]);
});

test('counts task checkboxes', () => {
  assert.deepEqual(taskCount('- [x] T1 a\n- [ ] T2 b\n  - [X] T3 c\n- [ ] not a task'), {
    done: 2,
    total: 3,
  });
});

test('a feature moves through specify, design, tasks, execute, pr and done', () => {
  const files = {};
  const ev = (merged = false) => ({ file: (n) => files[n] ?? null, merged });
  const large = { feature: 'beta', size: 'Large' };
  assert.equal(featureState(large, ev()).next, 'specify');
  files['spec.md'] = 's';
  files['acceptance.feature'] = 'a';
  assert.equal(featureState(large, ev()).next, 'design');
  assert.equal(featureState({ feature: 'x', size: 'Medium' }, ev()).next, 'tasks');
  files['design.md'] = 'd';
  files['tasks.md'] = '- [x] T1\n- [ ] T2';
  assert.equal(featureState(large, ev()).next, 'execute');
  files['tasks.md'] = '- [x] T1\n- [x] T2';
  assert.equal(featureState(large, ev()).next, 'pr');
  assert.equal(featureState(large, ev(true)).next, 'done');
});

test('the phase waits for approval, runs, then asks for the review and the merge', () => {
  const base = { phase: 'F1', review: null, mergedToMain: false, file: () => null, merged: () => false };
  assert.equal(derivePhaseState({ ...base, brief: null }).next, 'kickoff');
  assert.equal(derivePhaseState({ ...base, brief: brief(false) }).next, 'awaiting-approval');
  const running = derivePhaseState({ ...base, brief: brief() });
  assert.equal(running.next, 'run');
  assert.deepEqual(
    running.runnable.map((f) => f.feature),
    ['alpha'],
  );
  assert.deepEqual(running.features[1].waitingOn, ['alpha']);
  const allMerged = { ...base, brief: brief(), merged: () => true };
  assert.equal(derivePhaseState(allMerged).next, 'review');
  assert.equal(
    derivePhaseState({ ...allMerged, review: '**Approved**: 2026-12-01 - user: "ok"' }).next,
    'merge',
  );
  assert.equal(
    derivePhaseState({ ...allMerged, review: '**Approved**: 2026-12-01 - user: "ok"', mergedToMain: true })
      .next,
    'closed',
  );
});
