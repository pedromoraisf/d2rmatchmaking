import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../lib/gate-rules.mjs';
import { onStop, onFeedback, checkBudget } from '../lib/budget-rules.mjs';
import { toRelative } from '../lib/io.mjs';
import {
  emptyLedger,
  unitKey,
  recordAttempt,
  recordDispatch,
  reset,
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
  const fourth = call('Agent', input, ctx);
  assert.equal(fourth.decision, 'deny', 'the fourth dispatch of the same step is refused');
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

test('red stop: lets the agent stop when the machine failed', () => {
  const ledger = emptyLedger();
  const failing = [
    { status: 1, output: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' },
    { status: 127, output: 'sh: cargo: command not found' },
  ];
  for (let i = 0; i < 4; i += 1) {
    const verdict = onStop(ledger, 's7', '## typecheck\nCannot connect to the Docker daemon', failing);
    assert.equal(verdict.block, false);
    assert.doesNotMatch(verdict.message, /retry budget exhausted/);
    assert.match(verdict.message, /docker/);
    assert.match(verdict.message, /not-found/);
  }
  assert.deepEqual(ledger.units, {}, 'the red stop is not counted');
});

test('counts a red stop with a real failure', () => {
  const ledger = emptyLedger();
  const failing = [
    { status: 1, output: 'Cannot connect to the Docker daemon' },
    { status: 1, output: 'expected 2, received 3' },
  ];
  const verdict = onStop(ledger, 's6', '## typecheck\nCannot connect\n\n## unit tests\nexpected 2', failing);
  assert.equal(verdict.block, true);
  assert.match(verdict.message, /failure 1\/3, 2 retries left/);
  assert.equal(Object.keys(ledger.units).length, 1, 'the red stop is counted');
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

test('model policy: each dispatch step has a fixed subagent; no model or effort overrides; planning is not dispatchable', () => {
  const ledger = emptyLedger();
  const ctx = ctxFor({ ledger, branch: 'phase/F0' });
  const go = (input) => call('Agent', input, ctx)?.decision ?? null;
  const hdr = (step) => `[d2rmm feature=api-web-skeleton step=${step}] go`;
  assert.equal(go({ subagent_type: 'feature-worker', prompt: hdr('execute-batch-1') }), null);
  assert.equal(
    go({ subagent_type: 'general-purpose', prompt: hdr('execute-batch-2') }),
    'deny',
    'implementation only on feature-worker',
  );
  assert.equal(
    go({ subagent_type: 'feature-worker', model: 'opus', prompt: hdr('execute-batch-3') }),
    'deny',
    'no model override',
  );
  assert.equal(
    go({ subagent_type: 'feature-worker', effort: 'high', prompt: hdr('execute-batch-4') }),
    'deny',
    'no effort override',
  );
  assert.equal(
    go({ subagent_type: 'feature-worker', prompt: hdr('verify') }),
    'deny',
    'the implementer never verifies',
  );
  assert.equal(go({ subagent_type: 'verifier', prompt: hdr('verify') }), null);
  assert.equal(go({ subagent_type: 'spec-reviewer', prompt: hdr('review-spec') }), null);
  assert.equal(go({ subagent_type: 'security-reviewer', prompt: hdr('review-diff') }), null);
  for (const planning of ['spec', 'design', 'tasks', 'feature', 'execute']) {
    assert.equal(
      go({ subagent_type: 'feature-worker', prompt: hdr(planning) }),
      'deny',
      `${planning} is the orchestrator's`,
    );
  }
  assert.equal(
    go({ subagent_type: 'Explore', prompt: 'find the outbox code' }),
    null,
    'read-only helper needs no header',
  );
  assert.equal(go({ subagent_type: 'Explore', model: 'opus', prompt: 'x' }), 'deny');
});

test('agent frontmatter matches the model policy, and the orchestrator is pinned', async () => {
  const { readFileSync } = await import('node:fs');
  const { SUBAGENTS, ORCHESTRATOR, frontmatter } = await import('../../../scripts/lib/model-policy.mjs');
  const root = new URL('../../../', import.meta.url);
  for (const [type, pin] of Object.entries(SUBAGENTS)) {
    const fm = frontmatter(readFileSync(new URL(`.claude/agents/${type}.md`, root), 'utf8'));
    assert.equal(fm.model, pin.model, `${type} model`);
    assert.equal(fm.effort, pin.effort, `${type} effort`);
  }
  const settings = JSON.parse(readFileSync(new URL('.claude/settings.json', root), 'utf8'));
  assert.equal(settings.model, ORCHESTRATOR.model);
  assert.equal(settings.effortLevel, ORCHESTRATOR.effort);
});

test('worktrees are judged as their feature branch, and protected files stay protected inside them', () => {
  const ledger = emptyLedger();
  for (let i = 0; i < MAX_ATTEMPTS; i += 1)
    recordAttempt(ledger, unitKey('gate', 'agent-skeleton', 'T3'), false);
  const ctx = ctxFor({ ledger, branch: 'phase/F0' });
  assert.equal(
    call('Bash', { command: 'cd .claude/worktrees/agent-skeleton && git commit -m x' }, ctx).decision,
    'deny',
  );
  assert.equal(
    call('Bash', { command: 'git -C .claude/worktrees/agent-skeleton commit -m x' }, ctx).decision,
    'deny',
  );
  assert.equal(
    call(
      'Edit',
      {
        file_path: '/repo/.claude/worktrees/agent-skeleton/apps/agent/x.rs',
        old_string: 'a',
        new_string: 'b',
      },
      ctx,
    ).decision,
    'deny',
    'blocked feature: no code edits in its worktree',
  );
  const clean = ctxFor({ branch: 'phase/F0' });
  assert.equal(
    call(
      'Write',
      { file_path: '/repo/.claude/worktrees/api-web-skeleton/.claude/hooks/gate.mjs', content: 'x' },
      clean,
    ).decision,
    'ask',
  );
  assert.equal(
    call('Write', { file_path: '/repo/.claude/worktrees/api-web-skeleton/.env', content: 'x' }, clean)
      .decision,
    'deny',
  );
  assert.equal(
    call(
      'Write',
      { file_path: '/repo/.claude/worktrees/api-web-skeleton/.specs/phases/F0/attempts.json', content: '{}' },
      clean,
    ).decision,
    'deny',
  );
});

test("asks only for the maintainer's resets", () => {
  const key = 'gate:demo/T1';
  const fail = (ledger, n, extra = {}) => {
    for (let i = 0; i < n; i += 1) recordAttempt(ledger, key, false, { note: 'boom', ...extra });
    return ledger;
  };
  const blocked = () => fail(emptyLedger(), MAX_ATTEMPTS);
  const envBlocked = () => fail(emptyLedger(), 3, { kind: 'env', signature: 'docker' });
  const afterOrchestrator = () => {
    const l = blocked();
    reset(l, key, { by: 'orchestrator', reason: 'docker was stopped' });
    return fail(l, MAX_ATTEMPTS);
  };
  const afterBoth = () => {
    const l = afterOrchestrator();
    reset(l, key, { by: 'pedromoraisf', reason: 'maintainer' });
    return fail(l, MAX_ATTEMPTS);
  };
  const decisionFor = (ledger, command) => call('Bash', { command }, ctxFor({ ledger }))?.decision ?? null;
  const reset1 = (by, tail = "--reason 'fixed'") =>
    `node scripts/attempt.mjs reset --unit ${key} --by ${by} ${tail}`;

  assert.equal(
    decisionFor(blocked(), reset1('orchestrator')),
    null,
    'a blocked unit, first orchestrator reset',
  );
  assert.equal(decisionFor(envBlocked(), reset1('orchestrator')), null, 'an env-blocked unit');
  assert.equal(
    decisionFor(afterOrchestrator(), reset1('orchestrator')),
    'ask',
    'a second orchestrator reset',
  );
  assert.equal(decisionFor(afterBoth(), reset1('orchestrator')), 'ask', 'after the maintainer reset too');
  assert.equal(decisionFor(blocked(), reset1('pedromoraisf')), 'ask', 'the maintainer resets');
  assert.equal(decisionFor(blocked(), reset1('orchestrator', "--reason ''")), 'ask', 'an empty reason');
  assert.equal(decisionFor(blocked(), reset1('orchestrator', '')), 'ask', 'no reason');
  assert.equal(
    decisionFor(blocked(), `node scripts/attempt.mjs reset --by orchestrator --reason 'fixed'`),
    'ask',
    'no unit',
  );
  assert.equal(
    decisionFor(
      afterOrchestrator(),
      `node scripts/attempt.mjs reset --unit=${key} --by orchestrator --reason 'again'`,
    ),
    'ask',
    'the --unit=<key> form names the same unit',
  );
  assert.equal(decisionFor(blocked(), `${reset1('orchestrator')} && git commit -m x`), 'ask', 'chained');
});

test('allows read-only filters after the wrapper', () => {
  const ctx = ctxFor();
  const gate = 'node scripts/attempt.mjs run --feature agent-skeleton --step T3 -- "pnpm test"';
  for (const filter of [
    '2>&1 | tail -n 40',
    '| head -n 20',
    '2>&1 | grep FAIL',
    "| grep -i -E 'not ok|FAIL'",
    '| grep -c -v ok',
  ]) {
    const command = `${gate} ${filter}`;
    // BUD-18: the gate SHALL NOT deny the line. Through the whole gate an older shell-write rule may still ask (GPR-07).
    assert.notEqual(call('Bash', { command }, ctx)?.decision, 'deny', filter);
    // The wrapper rule itself gives no opinion on the line.
    assert.equal(checkBudget({ tool_name: 'Bash', tool_input: { command } }, ctx, 's1', ''), null, filter);
  }
});

test('denies anything else after the wrapper', () => {
  const ctx = ctxFor();
  const gate = 'node scripts/attempt.mjs run --feature agent-skeleton --step T3 -- "pnpm test"';
  for (const tail of [
    '| tee out.txt',
    '&& git commit -m x',
    '; rm -rf apps',
    '| grep $(rm -rf apps)',
    '| grep `rm -rf apps`',
    '| tail -n 5 > out.txt',
    '| tail -n 5 | sh',
    '| tail -5',
    '| grep -x FAIL',
  ]) {
    assert.equal(call('Bash', { command: `${gate} ${tail}` }, ctx).decision, 'deny', tail);
  }
});

test('hands over the corrected command', () => {
  const ctx = ctxFor();
  const inWorktree = { cwd: '/repo/.claude/worktrees/demo' };
  for (const [command, corrected] of [
    ['pnpm test', 'node scripts/attempt.mjs run --feature demo --step <step> -- "pnpm test"'],
    [
      'node scripts/attempt.mjs run --feature demo --step T1 -- pnpm test && ls',
      'node scripts/attempt.mjs run --feature demo --step T1 -- "pnpm test && ls"',
    ],
    [
      'node scripts/attempt.mjs run --feature demo --step proofs -- pnpm test; ls',
      'node scripts/attempt.mjs run --feature demo --step proofs -- "pnpm test; ls"',
    ],
  ]) {
    const r = call('Bash', { command }, ctx, inWorktree);
    assert.equal(r.decision, 'deny', command);
    assert.ok(r.reason.includes(corrected), `${command}\n→ ${r.reason}`);
  }
  const outside = call('Bash', { command: 'pnpm test' }, ctx);
  assert.ok(outside.reason.includes('--feature <feature> --step <step> -- "pnpm test"'), outside.reason);
});
