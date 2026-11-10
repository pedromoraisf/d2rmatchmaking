// HBS-18, HBS-19: the harness-self scope, the covered features of an approved brief, and the main checkout as the
// only place a phase and its brief are read from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DELEGATION_SCOPES, activePhase, coveredFeatures, delegatedScopes } from '../lib/delegation.mjs';
import { makeRepoContext } from '../lib/io.mjs';

// Under a git hook, git exports GIT_DIR and friends; the repositories below must be the temporary ones.
// Reassigning process.env does not reach child processes; deleting the keys does (checked by hand).
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) Reflect.deleteProperty(process.env, k);

const APPROVAL =
  '**Approved**: 2026-11-07 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego harness-self"';

function brief({
  tick = true,
  approved = true,
  covers = '`gate-precision` and `.claude/hooks/**` and `nope` and budget-v2',
} = {}) {
  return [
    '# F0 brief',
    '',
    '## Features',
    '',
    '| Feature        | Size   | Depends on       |',
    '| -------------- | ------ | ---------------- |',
    '| harness-bootstrap | Small | room-trace-link |',
    '| gate-precision | Large  | harness-bootstrap |',
    '| budget-v2      | Medium | harness-bootstrap |',
    '',
    '## Delegation',
    '',
    '- [x] specs-and-tasks: approve specs and tasks that pass the automatic gates',
    `- [${tick ? 'x' : ' '}] harness-self: edit the gate in the worktree of ${covers} (ADR 028)`,
    '',
    '## Approval',
    '',
    approved ? APPROVAL : '<!-- the maintainer writes this line -->',
    '',
  ].join('\n');
}

test('knows the harness-self scope', () => {
  assert.ok(DELEGATION_SCOPES.includes('harness-self'));
  assert.ok(delegatedScopes(brief()).has('harness-self'));
  assert.equal(delegatedScopes(brief({ tick: false })).has('harness-self'), false);
});

test('covers only backticked feature rows', () => {
  assert.deepEqual(coveredFeatures(brief()), ['gate-precision']);
});

test('covers nothing without a ticked, approved brief', () => {
  assert.deepEqual(coveredFeatures(brief({ tick: false })), []);
  assert.deepEqual(coveredFeatures(brief({ approved: false })), []);
  assert.deepEqual(coveredFeatures(null), []);
});

test('reads the brief of the main checkout from a worktree', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'd2rmm-delegation-')));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'phase/F0');
  mkdirSync(path.join(dir, '.specs/phases/F0'), { recursive: true });
  writeFileSync(path.join(dir, '.specs/phases/ACTIVE'), 'F0\n');
  writeFileSync(path.join(dir, '.specs/phases/F0/brief.md'), brief());
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'brief');
  const wt = path.join(dir, '.claude/worktrees/gate-precision');
  git('worktree', 'add', '-q', '-b', 'feat/F0-gate-precision', wt);
  // The worktree holds its own, unapproved copy of the brief: it must not be read.
  writeFileSync(
    path.join(wt, '.specs/phases/F0/brief.md'),
    brief({ approved: false, covers: '`budget-v2`' }),
  );

  const ctx = makeRepoContext(wt);
  assert.equal(realpathSync(ctx.mainRoot), dir);
  const phase = activePhase(ctx);
  assert.equal(phase.id, 'F0');
  assert.equal(phase.approved, true);
  assert.deepEqual(phase.covered, ['gate-precision']);
  assert.equal(phase.scopes.has('harness-self'), true);
});
