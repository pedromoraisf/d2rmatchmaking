import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefFeatures, derivePhaseState, featureState, specRow, taskCount } from '../lib/phase-state.mjs';

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
    open: 1,
    waiting: 0,
  });
});

test('counts nested and orchestrator boxes, never criteria without an id', () => {
  const text = [
    '## Batch 1',
    '- [x] T1 — a',
    '  - [ ] acceptance criterion under T1',
    '## Orchestrator (local)',
    '- [ ] O1 — b',
    '- [ ] T11b-2 — c',
    '    - [x] T3 — nested',
  ].join('\n');
  assert.deepEqual(taskCount(text), { done: 2, total: 4, open: 2, waiting: 0 });
});

test('an open task waits when marked, or under a "waits for the maintainer" section', () => {
  const text = [
    '## Batch 2',
    '- [ ] T8 — x. **Runs after the phase PR merges into `main`**',
    '- [ ] T9 — y. **Waiting**: input',
    '- [ ] T10 — z',
    "## Batch 3 — waits for the maintainer's field matrix",
    '- [ ] T11 — field',
    '## Batch 4',
    '- [ ] T12 — back to work',
  ].join('\n');
  assert.deepEqual(taskCount(text), { done: 0, total: 5, open: 5, waiting: 3 });
});

test('a merged feature is done only when no open task is left that is not waiting', () => {
  const row = { feature: 'x', size: 'Medium' };
  const file = (t) => (n) => (n === 'tasks.md' ? t : '');
  assert.equal(featureState(row, { file: file('- [x] T1\n- [ ] T2'), merged: true }).next, 'execute');
  assert.equal(featureState(row, { file: file('- [x] T1\n- [ ] O1'), merged: true }).next, 'execute');
  const waiting = featureState(row, { file: file('- [x] T1\n- [ ] T2 **Waiting**: x'), merged: true });
  assert.equal(waiting.next, 'done');
  assert.equal(waiting.tasks.waiting, 1);
});

test('with an open task a merged phase is not ready for review', () => {
  const ev = {
    phase: 'F1',
    brief: brief(),
    review: null,
    mergedToMain: false,
    file: (f, n) => (n === 'tasks.md' && f === 'beta' ? '- [ ] T1 — open' : null),
    merged: () => true,
  };
  const st = derivePhaseState(ev);
  assert.equal(st.next, 'run');
  assert.deepEqual(
    st.runnable.map((r) => r.feature),
    ['beta'],
  );
});

test('a spec of the phase that the brief does not list is a feature of the phase', () => {
  assert.deepEqual(specRow('bots', '# T\n\n**Phase**: F1 (covered) · **Size**: Large · **x**: y', 'F1'), {
    feature: 'bots',
    size: 'Large',
    dependsOn: [],
  });
  assert.equal(specRow('old', '**Phase**: F0 · **Size**: Medium', 'F1'), null);
  const st = derivePhaseState({
    phase: 'F1',
    brief: brief(),
    review: null,
    mergedToMain: false,
    specRows: [
      { feature: 'bots', size: 'Medium', dependsOn: [] },
      { feature: 'alpha', size: 'Medium', dependsOn: [] },
    ],
    file: () => null,
    merged: () => false,
  });
  assert.deepEqual(
    st.features.map((f) => f.feature),
    ['alpha', 'beta', 'bots'],
  );
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

test('a closed phase stays closed: no discovered spec or old open box reopens it (F1 shape)', () => {
  const approved = '**Approved**: 2026-12-01 - user: "ok"';
  const st = derivePhaseState({
    phase: 'F1',
    brief: brief(),
    review: approved,
    mergedToMain: true,
    specRows: [{ feature: 'late', size: 'Medium', dependsOn: [] }],
    file: (f, n) => (n === 'tasks.md' ? '- [x] T1 — a\n- [ ] T2 — old open box' : null),
    merged: () => true,
  });
  assert.equal(st.next, 'closed');
  assert.deepEqual(st.runnable, []);
  assert.deepEqual(
    st.features.map((f) => [f.feature, f.next]),
    [
      ['alpha', 'done'],
      ['beta', 'done'],
    ],
  );
});
