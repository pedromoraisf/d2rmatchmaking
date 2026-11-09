import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  derivePhaseState,
  briefFeatures,
  maintainerItems,
  parseTrailers,
  renderRunnerState,
  writeRunnerState,
} from '../lib/phase-state.mjs';
import { checkTrailers } from '../lib/trailers.mjs';
import { checkRoadmap, prdRequirements } from '../lib/roadmap.mjs';
import { mergeLedgers, emptyLedger, recordAttempt, unitKey, MAX_ATTEMPTS } from '../lib/budget.mjs';

const W = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const BRIEF = `# F0

## Features

| Feature | Size | Depends on | Parallel | Covers | Wall-clock |
| --- | --- | --- | --- | --- | --- |
| core | Large | — | no | FR-03 | default |
| web | Medium | core | yes | FR-29 | default |

## Approval

**Approved**: 2026-11-02 - user: "${W}"

## Runner state

old hand-written junk
`;
const APPROVED = `**Approved**: 2026-11-03 - user: "${W}" (delegated via .specs/phases/F0/brief.md)`;
const TASKS = `# Tasks\n${APPROVED}\n\n### T1: a\n\n### T2: b\n`;

function ev(files = {}, commits = [], phaseCommits = [], extra = {}) {
  return {
    phase: 'F0',
    brief: BRIEF,
    review: null,
    mergedToMain: false,
    file: (f, n) => files[`${f}/${n}`] ?? null,
    commits: commits.map((body) => ({ body })),
    phaseCommits: phaseCommits.map((body) => ({ body })),
    blocked: () => false,
    ...extra,
  };
}
const next = (s, f) => s.features.find((x) => x.feature === f);

test('brief features table and trailers parse', () => {
  assert.deepEqual(
    briefFeatures(BRIEF).map((r) => [r.feature, r.dependsOn]),
    [
      ['core', []],
      ['web', ['core']],
    ],
  );
  assert.deepEqual(parseTrailers('feat: x\n\nFeature: core\nTask: T2\n'), { feature: 'core', task: 'T2' });
});

test('each feature advances step by step from evidence only', () => {
  const steps = [];
  const files = {};
  const push = () => steps.push(next(derivePhaseState(ev(files)), 'core').next);
  push(); // specify
  files['core/spec.md'] = '# spec';
  files['core/acceptance.feature'] = 'Feature: x';
  push(); // spec-gate
  files['core/spec.md'] = `# spec\n${APPROVED}`;
  push(); // design (Large)
  files['core/design.md'] = '# design';
  push(); // tasks
  files['core/tasks.md'] = '# Tasks\n\n### T1: a\n';
  push(); // tasks-gate
  assert.deepEqual(steps, ['specify', 'spec-gate', 'design', 'tasks', 'tasks-gate']);
});

test('execute → proofs → verify → integrate → done, driven by commit trailers', () => {
  const files = {
    'core/spec.md': `x\n${APPROVED}`,
    'core/acceptance.feature': 'Feature: x',
    'core/design.md': 'd',
    'core/tasks.md': TASKS,
  };
  let s = derivePhaseState(ev(files, ['feat: a\n\nFeature: core\nTask: T1']));
  assert.equal(next(s, 'core').next, 'execute');
  assert.equal(next(s, 'core').task, 'T2');
  assert.deepEqual(next(s, 'core').tasks, { total: 2, done: 1 });
  const all = ['Feature: core\nTask: T1', 'Feature: core\nTask: T2'];
  assert.equal(next(derivePhaseState(ev(files, all)), 'core').next, 'proofs');
  files['core/proofs.md'] = 'p';
  files['core/verification.md'] = 'v';
  assert.equal(next(derivePhaseState(ev(files, all)), 'core').next, 'verify');
  const closed = [...all, 'Feature: core\nStep: verification'];
  assert.equal(next(derivePhaseState(ev(files, closed)), 'core').next, 'integrate');
  s = derivePhaseState(ev(files, closed, closed));
  assert.equal(next(s, 'core').next, 'done');
  assert.equal(next(s, 'web').status, 'ready', 'dependency integrated → dependent is ready');
});

test('re-running on the same evidence gives the same state (idempotent)', () => {
  const files = { 'core/spec.md': 'x', 'core/acceptance.feature': 'y' };
  assert.deepEqual(derivePhaseState(ev(files)), derivePhaseState(ev(files)));
});

test('dependencies, blocked features and phase-level steps', () => {
  let s = derivePhaseState(ev());
  assert.equal(s.next, 'run');
  assert.equal(next(s, 'web').status, 'waiting');
  assert.deepEqual(s.runnable, [{ feature: 'core', step: 'specify', task: null }]);
  s = derivePhaseState(ev({}, [], [], { blocked: (f) => f === 'core' }));
  assert.equal(s.phaseBlocked, true, 'everything left depends on a blocked feature');
  assert.equal(derivePhaseState(ev({}, [], [], { brief: null })).next, 'kickoff');
  assert.equal(
    derivePhaseState(ev({}, [], [], { brief: BRIEF.replace(/\*\*Approved.*\n/, '') })).next,
    'awaiting-approval',
  );
});

test('phase closes only after review approval and merge to main', () => {
  const files = {};
  for (const f of ['core', 'web']) {
    Object.assign(files, {
      [`${f}/spec.md`]: APPROVED,
      [`${f}/acceptance.feature`]: 'F',
      [`${f}/design.md`]: 'd',
      [`${f}/tasks.md`]: TASKS,
      [`${f}/proofs.md`]: 'p',
      [`${f}/verification.md`]: 'v',
    });
  }
  const c = ['core', 'web'].flatMap((f) => [
    `Feature: ${f}\nTask: T1`,
    `Feature: ${f}\nTask: T2`,
    `Feature: ${f}\nStep: verification`,
  ]);
  assert.equal(derivePhaseState(ev(files, c, c)).next, 'review');
  assert.equal(derivePhaseState(ev(files, c, c, { review: '# review' })).next, 'awaiting-review');
  const reviewed = `# review\n**Approved**: 2026-11-20 - user: "aprovo a F0"`;
  assert.equal(derivePhaseState(ev(files, c, c, { review: reviewed })).next, 'merge');
  assert.equal(derivePhaseState(ev(files, c, c, { review: reviewed, mergedToMain: true })).next, 'closed');
});

test('runner state section is regenerated, never appended twice', () => {
  const s = derivePhaseState(ev());
  const once = writeRunnerState(BRIEF, renderRunnerState(s));
  assert.equal(writeRunnerState(once, renderRunnerState(s)), once);
  assert.ok(!once.includes('old hand-written junk'));
  assert.match(once, /\| core \| specify \| ready \| 0\/0 \|/);
});

test('commit trailers are required on feature branches only', () => {
  assert.deepEqual(checkTrailers('main', 'chore: x', []), []);
  assert.deepEqual(checkTrailers('feat/F0-core', 'feat: x\n\nFeature: core\nTask: T1', ['T1']), []);
  assert.deepEqual(checkTrailers('feat/F0-core', 'docs: x\n\nFeature: core\nStep: spec', []), []);
  assert.equal(checkTrailers('feat/F0-core', 'feat: x', ['T1']).length, 2);
  assert.match(checkTrailers('feat/F0-core', 'Feature: core\nTask: T9', ['T1'])[0], /not a task id/);
  assert.match(checkTrailers('feat/F0-core', 'Feature: web\nStep: spec', [])[0], /Feature: core/);
  assert.match(checkTrailers('feat/F0-core', 'Feature: core\nStep: whatever', [])[0], /not a known step/);
});

test('ledger snapshot merge never loosens; a newer maintainer reset wins', () => {
  const live = emptyLedger();
  const snap = emptyLedger();
  const k = unitKey('gate', 'core', 'T1');
  for (let i = 0; i < MAX_ATTEMPTS; i += 1)
    recordAttempt(snap, k, false, { at: `2026-11-0${i + 1}T00:00:00Z` });
  recordAttempt(live, k, false, { at: '2026-11-01T00:00:00Z' });
  assert.equal(mergeLedgers(live, snap).units[k].status, 'blocked', 'fresh clone keeps the block');
  live.resets = [{ key: k, by: 'pedro', at: '2026-11-09T00:00:00Z' }];
  live.units = {};
  assert.equal(mergeLedgers(live, snap).units[k], undefined, 'reset newer than the snapshot clears it');
});

test('roadmap: every PRD requirement has exactly one primary phase; approved briefs cover theirs', () => {
  const prd = readFileSync(new URL('../../docs/product/prd.md', import.meta.url), 'utf8');
  const roadmap = readFileSync(new URL('../../.specs/phases/ROADMAP.md', import.meta.url), 'utf8');
  assert.equal(prdRequirements(prd).length, 46);
  assert.deepEqual(checkRoadmap(prd, roadmap, {}), []);
  const f0 = readFileSync(new URL('../../.specs/phases/F0/brief.md', import.meta.url), 'utf8');
  const approvedF0 = `${f0}\n**Approved**: 2026-11-02 - user: "ok"\n`;
  assert.deepEqual(
    checkRoadmap(prd, roadmap, { F0: approvedF0 }),
    [],
    'the F0 draft covers every F0 requirement',
  );
  assert.ok(checkRoadmap(prd, roadmap, { F1: '**Approved**: 2026-12-01 - user: "ok"\nFR-01' }).length > 10);
  const dup = roadmap.replace(/(\|\s*F4\s*\|\s*NFR-05)/, '$1, FR-01');
  assert.ok(checkRoadmap(prd, dup, {}).some((e) => /FR-01 has more than one/.test(e)));
});

// CDL-08 to CDL-10 (continuous-delivery): the `## For the maintainer` table of decisions.md blocks only its feature.
const BRIEF3 = BRIEF.replace(
  '| web | Medium | core | yes | FR-29 | default |',
  '| web | Medium | core | yes | FR-29 | default |\n| docs | Small | — | yes | FR-30 | default |',
);
const MAINTAINER = (rows) =>
  `# Decisions\n\n## For the maintainer\n\n| Feature | Item | Asked | Answer |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;

test('an open maintainer item blocks only its feature', () => {
  const decisions = MAINTAINER(['| core | Create the TURSO_TOKEN secret | 2026-11-08 |  |']);
  const s = derivePhaseState(ev({}, [], [], { brief: BRIEF3, decisions }));
  assert.equal(next(s, 'core').status, 'blocked');
  assert.equal(next(s, 'core').reason, 'maintainer');
  assert.equal(next(s, 'web').status, 'waiting', 'a dependent of the blocked feature waits');
  assert.equal(next(s, 'docs').status, 'ready', 'an independent feature keeps its state');
  assert.equal(next(s, 'docs').next, 'specify');
});

test('an answered maintainer item no longer blocks', () => {
  const answered = MAINTAINER(['| core | Create the TURSO_TOKEN secret | 2026-11-08 | done |']);
  assert.equal(
    next(derivePhaseState(ev({}, [], [], { brief: BRIEF3, decisions: answered })), 'core').status,
    'ready',
  );
  const spaces = MAINTAINER(['| core | Create the TURSO_TOKEN secret | 2026-11-08 |    |']);
  assert.equal(
    next(derivePhaseState(ev({}, [], [], { brief: BRIEF3, decisions: spaces })), 'core').status,
    'blocked',
  );
});

test('lists open maintainer items by feature', () => {
  const decisions = MAINTAINER([
    '| core | Create the TURSO_TOKEN secret | 2026-11-08 |  |',
    '| core | Apply the main ruleset | 2026-11-08 |  |',
    '| omega | Pay for a larger runner | 2026-11-08 |  |',
    '| docs | Old question | 2026-11-01 | yes |',
  ]);
  assert.deepEqual(
    maintainerItems(decisions).map((i) => [i.feature, i.item, i.open]),
    [
      ['core', 'Create the TURSO_TOKEN secret', true],
      ['core', 'Apply the main ruleset', true],
      ['omega', 'Pay for a larger runner', true],
      ['docs', 'Old question', false],
    ],
  );
  const s = derivePhaseState(ev({}, [], [], { brief: BRIEF3, decisions }));
  assert.deepEqual(
    next(s, 'core').items.map((i) => i.item),
    ['Create the TURSO_TOKEN secret', 'Apply the main ruleset'],
  );
  assert.deepEqual(
    s.phaseItems.map((i) => [i.feature, i.item]),
    [['omega', 'Pay for a larger runner']],
    'an item for a feature not in the brief lands on the phase',
  );
});

test('no maintainer table changes nothing', () => {
  const plain = derivePhaseState(ev({}, [], [], { brief: BRIEF3 }));
  for (const decisions of [null, '# Decisions\n\nno table here\n', MAINTAINER([])]) {
    const s = derivePhaseState(ev({}, [], [], { brief: BRIEF3, decisions }));
    assert.deepEqual(s, plain);
  }
  assert.deepEqual(maintainerItems(null), []);
  assert.ok(plain.features.every((f) => f.blocked === false));
});
