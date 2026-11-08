import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpecs } from '../lib/specs.mjs';

const WORDS = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const brief = (scopes = '- [x] specs-and-tasks: ok') =>
  `# F0\n\n| harness-foundation | Complex |\n\n## Delegation\n${scopes}\n\n**Approved**: 2026-11-02 - user: "${WORDS}"\n`;

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
  r = repo({
    ...base,
    '.specs/phases/F0/brief.md': brief('- [ ] specs-and-tasks: no'),
    '.specs/features/harness-foundation/spec.md': approved,
  });
  assert.match(checkSpecs(r.read, r.list)[0], /does not delegate/);
  r = repo({ ...base, '.specs/features/other-feature/spec.md': approved });
  assert.match(checkSpecs(r.read, r.list)[0], /not listed/);
});

test('assumed decisions must be queued for the phase review', () => {
  const r = repo({ ...base, '.specs/STATE.md': '# State\n### AD-022 — Use X (assumed)\n' });
  assert.match(checkSpecs(r.read, r.list)[0], /AD-022/);
  const ok = repo({
    ...base,
    '.specs/STATE.md': '### AD-022 — Use X (assumed)\n',
    '.specs/phases/F0/decisions.md': '- AD-022',
  });
  assert.deepEqual(checkSpecs(ok.read, ok.list), []);
});

test('missing state and phase files are reported', () => {
  const r = repo({ '.specs/phases/ACTIVE': 'F0' });
  assert.equal(checkSpecs(r.read, r.list).length, 3);
});

// A tasks.md of feature "demo": T1 is done, T2 is open with the given Done-when boxes and gate.
const demoTasks = (t2Boxes, t2Gate, extra = '') => `# Tasks

### T1: First

**What**: a thing

**Done when**:

- [x] first criterion

**Gate**: \`node --test scripts/test/x.test.mjs\`

### T2: Second

**What**: another thing

**Done when**:

${t2Boxes}

**Gate**: \`${t2Gate}\`

${extra}## Handoff

Nothing yet.
`;
const demo = (tasks) => repo({ ...base, '.specs/features/demo/tasks.md': tasks });

// CFP-11: an open task whose gate runs mutation is refused, whichever of the four gate forms it takes.
test('refuses mutation in the gate of an open task', () => {
  const gates = [
    'pnpm test:mutation',
    'pnpm test:mutation:agent',
    'cargo mutants --package d2rmm-agent-core -- --lib',
    'node --test x.test.mjs && cargo-mutants --package d2rmm-agent-domain -- --lib',
  ];
  for (const gate of gates) {
    const r = demo(demoTasks('- [ ] a criterion', gate));
    const errors = checkSpecs(r.read, r.list);
    assert.equal(errors.length, 1, `${gate} is refused`);
    assert.match(errors[0], /"demo"/u, 'the feature is named');
    assert.match(errors[0], /task T2/u, 'the task is named');
  }
});

// CFP-11: one unticked box makes the task open, so its mutation gate is refused.
test('treats a partly ticked task as open', () => {
  const r = demo(demoTasks('- [x] a criterion\n- [ ] another criterion', 'pnpm test:mutation'));
  const errors = checkSpecs(r.read, r.list);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"demo"/u);
  assert.match(errors[0], /task T2/u);
});

// CFP-12: a done task keeps its mutation gate, and an open task whose gate runs no mutation passes.
test('passes done tasks and gates without mutation', () => {
  const done = demo(demoTasks('- [x] a criterion', 'pnpm test:mutation'));
  assert.deepEqual(checkSpecs(done.read, done.list), []);
  const open = demo(demoTasks('- [ ] a criterion', 'node --test scripts/test/x.test.mjs'));
  assert.deepEqual(checkSpecs(open.read, open.list), []);
});

// CFP-11, CFP-12: only the Done when boxes decide whether a task is open; an unticked box in another section does not.
test('ignores unticked boxes outside Done when', () => {
  const stray = '**Notes**:\n\n- [ ] a follow-up outside the criteria\n\n';
  const r = demo(demoTasks('- [x] a criterion', 'pnpm test:mutation', stray));
  assert.deepEqual(checkSpecs(r.read, r.list), []);
});
