import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../lib/gate-rules.mjs';
import { onStop, onFeedback } from '../lib/budget-rules.mjs';
import { toRelative } from '../lib/io.mjs';
import {
  emptyLedger,
  unitKey,
  recordAttempt,
  recordDispatch,
  MAX_ATTEMPTS,
} from '../../../scripts/lib/budget.mjs';

const WORDS = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const BRIEF = `| api-web-skeleton | agent-skeleton |\n## Delegation\n- [x] specs-and-tasks: x\n- [x] sub-agents: x\n\n**Approved**: 2026-11-02 - user: "${WORDS}"\n`;

function ctxFor({
  branch = 'feat/F0-agent-skeleton',
  ledger = emptyLedger(),
  approved = true,
  headTime = 1_800_000_000,
} = {}) {
  const files = {
    '.specs/phases/ACTIVE': 'F0',
    '.specs/phases/F0/brief.md': approved ? BRIEF : '## Delegation\n',
  };
  return {
    root: '/repo',
    readFile: (rel) => files[rel] ?? null,
    isTracked: () => false,
    currentBranch: () => branch,
    headTime: () => headTime,
    git: () => '',
    ledger,
  };
}
const call = (tool_name, tool_input, ctx, extra = {}) =>
  decide({ tool_name, tool_input, session_id: 's1', ...extra }, ctx, toRelative);
const apply = (ledger, r) => {
  for (const e of r?.effects ?? []) {
    if (e.op === 'fail') recordAttempt(ledger, e.key, false, { note: e.note });
    if (e.op === 'dispatch') recordDispatch(ledger, e.key, { note: e.note });
  }
};

test('during a phase run, tests and gates only run through the attempt wrapper', () => {
  const ctx = ctxFor();
  assert.equal(call('Bash', { command: 'pnpm test' }, ctx).decision, 'deny');
  assert.equal(call('Bash', { command: 'cd apps/api && npx vitest run' }, ctx).decision, 'deny');
  assert.equal(
    call(
      'Bash',
      { command: 'python3 .claude/skills/tlc-spec-driven/scripts/check_proofs.py agent-skeleton' },
      ctx,
    ).decision,
    'deny',
  );
  const wrapped =
    'node scripts/attempt.mjs run --feature agent-skeleton --step T3 -- "pnpm test && pnpm lint"';
  assert.equal(call('Bash', { command: wrapped }, ctx)?.decision ?? null, null);
  const leaky = 'node scripts/attempt.mjs run --feature agent-skeleton --step T3 -- pnpm test && pnpm lint';
  assert.equal(call('Bash', { command: leaky }, ctx).decision, 'deny');
  // Outside a phase run (no approved brief) or off phase/feature branches the wrapper is not required.
  assert.equal(call('Bash', { command: 'pnpm test' }, ctxFor({ approved: false }))?.decision ?? null, null);
  assert.equal(call('Bash', { command: 'pnpm test' }, ctxFor({ branch: 'main' }))?.decision ?? null, null);
});

test('commits need a passing gate attempt recorded after the last commit', () => {
  const ledger = emptyLedger();
  const ctx = ctxFor({ ledger, headTime: Date.parse('2026-11-03T10:00:00Z') / 1000 });
  assert.equal(call('Bash', { command: 'git commit -m "feat(agent): x"' }, ctx).decision, 'deny');
  recordAttempt(ledger, unitKey('gate', 'agent-skeleton', 'T1'), true, { at: '2026-11-03T09:00:00Z' });
  assert.equal(
    call('Bash', { command: 'git commit -m "feat(agent): x"' }, ctx).decision,
    'deny',
    'pass is older than HEAD',
  );
  recordAttempt(ledger, unitKey('gate', 'agent-skeleton', 'T2'), false, { at: '2026-11-03T11:00:00Z' });
  assert.equal(
    call('Bash', { command: 'git commit -m "feat(agent): x"' }, ctx).decision,
    'deny',
    'latest attempt failed',
  );
  recordAttempt(ledger, unitKey('gate', 'agent-skeleton', 'T2'), true, { at: '2026-11-03T11:05:00Z' });
  assert.equal(call('Bash', { command: 'git commit -m "feat(agent): x"' }, ctx)?.decision ?? null, null);
});

test('a blocked feature takes no more code edits, commits or dispatches', () => {
  const ledger = emptyLedger();
  const k = unitKey('gate', 'agent-skeleton', 'T3');
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordAttempt(ledger, k, false, { note: 'boom' });
  const ctx = ctxFor({ ledger });
  assert.equal(
    call('Edit', { file_path: '/repo/apps/agent/src-tauri/src/x.rs', old_string: 'a', new_string: 'b' }, ctx)
      .decision,
    'deny',
  );
  assert.equal(
    call(
      'Write',
      { file_path: '/repo/.specs/features/agent-skeleton/tasks.md', content: '## Handoff\nblocked' },
      ctx,
    )?.decision ?? null,
    null,
  );
  assert.equal(call('Bash', { command: 'git commit -m x' }, ctx).decision, 'deny');
  const dispatch = {
    subagent_type: 'feature-worker',
    prompt: '[d2rmm feature=agent-skeleton step=execute-batch-1] go',
  };
  assert.equal(call('Agent', dispatch, ctx).decision, 'deny');
});

test('subagent dispatch: header required, then 1 + 2 retries per (feature, step, type)', () => {
  const ledger = emptyLedger();
  const ctx = ctxFor({ ledger, branch: 'phase/F0' });
  assert.equal(call('Agent', { subagent_type: 'verifier', prompt: 'verify it' }, ctx).decision, 'deny');
  const input = {
    subagent_type: 'feature-worker',
    description: 'run feature',
    prompt: '[d2rmm feature=api-web-skeleton step=execute-batch-1] go',
  };
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const r = call('Agent', input, ctx);
    assert.equal(r?.decision ?? null, null, `dispatch ${i} allowed`);
    apply(ledger, r);
  }
  const fourth = call('Agent', { ...input, subagent_type: 'general-purpose' }, ctx);
  assert.equal(fourth.decision, 'deny', 'switching the subagent type does not reset the budget');
  assert.match(fourth.reason, /BLOCKED/);
  const renamed = { ...input, prompt: '[d2rmm feature=api-web-skeleton step=execute-batch-1b] go' };
  assert.equal(call('Agent', renamed, ctx).decision, 'deny', 'renaming the step does not reset the budget');
  const unlisted = { ...input, prompt: '[d2rmm feature=made-up step=execute] go' };
  assert.equal(call('Agent', unlisted, ctx).decision, 'deny', 'features must be in the brief');
  // Without an approved phase, dispatches are not budgeted by the gate.
  assert.equal(call('Agent', { prompt: 'anything' }, ctxFor({ approved: false }))?.decision ?? null, null);
});

test('the same denial is allowed twice more; the third exhausts the session', () => {
  const ledger = emptyLedger();
  const ctx = ctxFor({ ledger, branch: 'main' });
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const r = call('Bash', { command: 'git reset --hard' }, ctx);
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, new RegExp(`denial ${i}/${MAX_ATTEMPTS}`));
    apply(ledger, r);
  }
  const after = call('Bash', { command: 'pnpm build' }, ctx);
  assert.equal(after.decision, 'deny');
  assert.match(after.reason, /Retry budget exhausted/);
  assert.equal(
    call('Bash', { command: 'git status && node scripts/attempt.mjs report' }, ctx)?.decision ?? null,
    null,
  );
  assert.equal(
    call('Write', { file_path: '/repo/.specs/phases/F0/decisions.md', content: 'blocked' }, ctx)?.decision ??
      null,
    null,
  );
  // Another agent session (parallel worker) keeps its own budget.
  const other = decide(
    { tool_name: 'Bash', tool_input: { command: 'pnpm build' }, session_id: 's1', agent_id: 'w2' },
    ctx,
    toRelative,
  );
  assert.equal(other?.decision ?? null, null);
});

test('the ledger itself is unreachable and resets ask the maintainer', () => {
  const ctx = ctxFor();
  assert.equal(
    call('Write', { file_path: '/repo/.git/d2rmm/ledger.json', content: '{}' }, ctx).decision,
    'deny',
  );
  assert.equal(call('Bash', { command: 'echo {} > .git/d2rmm/ledger.json' }, ctx).decision, 'deny');
  assert.equal(
    call(
      'Bash',
      { command: 'D2RMM_LEDGER=/tmp/x node scripts/attempt.mjs run --feature a --step T1 -- "true"' },
      ctx,
    ).decision,
    'deny',
  );
  assert.equal(
    call('Bash', { command: 'node scripts/attempt.mjs reset --unit gate:a/T1 --by me' }, ctx).decision,
    'ask',
  );
});

test('stop: red blocks twice, the third red stop is let through with the session exhausted', () => {
  const ledger = emptyLedger();
  const a = onStop(ledger, 's9', 'typecheck failed');
  assert.equal(a.block, true);
  assert.match(a.message, /failure 1\/3, 2 retries left/);
  assert.equal(onStop(ledger, 's9', 'typecheck failed').block, true);
  const c = onStop(ledger, 's9', 'typecheck failed');
  assert.equal(c.block, false);
  assert.match(c.message, /retry budget exhausted/);
  // Green clears a non-exhausted counter.
  const l2 = emptyLedger();
  onStop(l2, 's8', 'x');
  onStop(l2, 's8', '');
  assert.deepEqual(l2.units, {});
});

test('feedback: the same sensor failing on the same file three times in a row is blocked', () => {
  const ledger = emptyLedger();
  const red = [{ id: 'eslint', ok: false, out: 'no-unused-vars' }];
  assert.deepEqual(onFeedback(ledger, 's1', 'apps/api/src/a.ts', red), []);
  assert.deepEqual(onFeedback(ledger, 's1', 'apps/api/src/a.ts', red), []);
  assert.equal(onFeedback(ledger, 's1', 'apps/api/src/a.ts', red).length, 1);
  const l2 = emptyLedger();
  onFeedback(l2, 's1', 'b.ts', red);
  onFeedback(l2, 's1', 'b.ts', [{ id: 'eslint', ok: true }]);
  assert.deepEqual(l2.units, {}, 'green resets');
});

test('the retry budget code and its tests protect themselves even under harness-edits delegation', async () => {
  const { checkEdit } = await import('../lib/gate-rules.mjs');
  const brief = BRIEF.replace('## Delegation\n', '## Delegation\n- [x] harness-edits: x\n');
  const ctx = {
    ...ctxFor({ branch: 'main' }),
    readFile: (rel) => ({ '.specs/phases/ACTIVE': 'F0', '.specs/phases/F0/brief.md': brief })[rel] ?? null,
  };
  for (const rel of [
    'scripts/lib/budget.mjs',
    'scripts/lib/ledger-store.mjs',
    'scripts/lib/steps.mjs',
    'scripts/attempt.mjs',
    'scripts/test/budget.test.mjs',
  ]) {
    assert.equal(checkEdit(rel, { content: 'export const MAX_RETRIES = 99;' }, ctx)?.decision, 'ask', rel);
  }
  assert.equal(
    checkEdit('lefthook.yml', { content: 'x' }, ctx)?.decision ?? null,
    null,
    'delegated harness file still editable',
  );
});
