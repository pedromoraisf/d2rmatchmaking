// HBS-32 to HBS-36 and HBS-46 to HBS-48: a covered feature merges only at its proven head, pinned for a PR, and no other
// git command brings its commits in. Real temporary repositories; the ledger and the verdicts are set by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { guardDecision } from '../lib/guard.mjs';
import { makeRepoContext } from '../lib/io.mjs';

// Under a git hook, git exports GIT_DIR and friends; the repositories below must be the temporary ones.
// Reassigning process.env does not reach child processes; deleting the keys does.
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) Reflect.deleteProperty(process.env, k);

const BRIEF = [
  '## Features',
  '',
  '| Feature | Size |',
  '| --- | --- |',
  '| gate-precision | Large |',
  '',
  '## Delegation',
  '',
  '- [x] harness-self: edit the gate in the worktree of `gate-precision` (ADR 028)',
  '',
  '## Approval',
  '',
  '**Approved**: 2026-11-07 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego harness-self"',
  '',
].join('\n');
const BRANCH = 'feat/F0-gate-precision';
const NOW = '2026-11-07T10:00:00Z';

/** A temporary repository: `main` with the approved brief, `phase/F0` at the base, `feat/F0-gate-precision` one commit on. */
function fixture() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'd2rmm-guard-')));
  const g = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (file, text) => {
    writeFileSync(path.join(dir, file), text);
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
    return g('rev-parse', 'HEAD');
  };
  g('init', '-q', '-b', 'main');
  mkdirSync(path.join(dir, '.specs/phases/F0'), { recursive: true });
  writeFileSync(path.join(dir, '.specs/phases/ACTIVE'), 'F0\n');
  writeFileSync(path.join(dir, '.specs/phases/F0/brief.md'), BRIEF);
  const base = commit('README.md', 'base\n');
  g('branch', 'phase/F0');
  g('checkout', '-q', '-b', BRANCH);
  const head = commit('gate.txt', 'one\n');
  g('checkout', '-q', 'main');
  const newCommitOn = (name, text) => {
    g('checkout', '-q', '-b', name, head);
    const sha = commit(`${name}.txt`, text);
    g('checkout', '-q', 'main');
    return sha;
  };
  return { dir, g, base, head, newCommitOn, ctx: makeRepoContext(dir) };
}

/** A ledger with one attempt of the harness command at `head`, on a clean tree, for the feature. */
function ledgerAt(head, attempt = {}) {
  return {
    units: {
      'gate:gate-precision/T1': {
        status: 'passed',
        attempts: [{ at: NOW, ok: true, command: 'pnpm test:harness', clean: true, head, ...attempt }],
      },
    },
  };
}
/** A verdict store with the given verdicts for the feature. */
const verdictsAt = (...verdicts) => ({
  notes: {},
  verdicts: verdicts.map(([head, verdict]) => ({ feature: 'gate-precision', head, verdict, at: NOW })),
});
const provenAt = (ctx, head) => {
  ctx.ledger = ledgerAt(head);
  ctx.verdicts = verdictsAt([head, 'PASS']);
  return ctx;
};
const decision = (cmd, ctx) => guardDecision(cmd, ctx)?.decision ?? 'none';
const reason = (cmd, ctx) => guardDecision(cmd, ctx)?.reason ?? '';

test('denies a covered merge without both proofs at its head', () => {
  const f = fixture();
  const cases = [
    ['no proof', f.ctx, ['pnpm test:harness', 'security-reviewer']],
    [
      'only a passed harness run at the head',
      { ...f.ctx, ledger: ledgerAt(f.head), verdicts: verdictsAt() },
      ['security-reviewer', 'review-diff'],
    ],
    [
      'only a PASS at the head',
      { ...f.ctx, ledger: { units: {} }, verdicts: verdictsAt([f.head, 'PASS']) },
      ['pnpm test:harness', 'attempt.mjs'],
    ],
    [
      'both proofs at an older commit',
      { ...f.ctx, ledger: ledgerAt(f.base), verdicts: verdictsAt([f.base, 'PASS']) },
      ['pnpm test:harness', 'security-reviewer'],
    ],
    [
      'a harness run through `|| true`',
      {
        ...f.ctx,
        ledger: {
          units: {
            'gate:gate-precision/T1': {
              attempts: [{ ok: true, command: 'pnpm test:harness || true', clean: true, head: f.head }],
            },
          },
        },
        verdicts: verdictsAt([f.head, 'PASS']),
      },
      ['pnpm test:harness', 'attempt.mjs'],
    ],
    [
      'a harness run on a dirty tree',
      { ...f.ctx, ledger: ledgerAt(f.head, { clean: false }), verdicts: verdictsAt([f.head, 'PASS']) },
      ['pnpm test:harness', 'attempt.mjs'],
    ],
    [
      'a PASS then a FAIL at the head',
      { ...f.ctx, ledger: ledgerAt(f.head), verdicts: verdictsAt([f.head, 'PASS'], [f.head, 'FAIL']) },
      ['security-reviewer', 'review-diff'],
    ],
  ];
  for (const [name, ctx, named] of cases) {
    const cmd = `git merge --no-ff ${BRANCH}`;
    assert.equal(decision(cmd, ctx), 'deny', name);
    for (const word of named) assert.ok(reason(cmd, ctx).includes(word), `${name}: ${reason(cmd, ctx)}`);
  }
});

test('merges a covered branch only at its proven head', () => {
  // A branch holding the head and one more commit.
  let f = fixture();
  f.g('checkout', '-q', '-b', 'foo', f.head);
  writeFileSync(path.join(f.dir, 'more.txt'), 'x\n');
  f.g('add', '.');
  f.g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'more');
  f.g('checkout', '-q', 'main');
  assert.equal(
    decision('git merge --no-ff foo', provenAt(f.ctx, f.head)),
    'deny',
    'a branch with one more commit',
  );

  // origin/<branch> points to a newer commit.
  f = fixture();
  f.g('update-ref', `refs/remotes/origin/${BRANCH}`, f.newCommitOn('newer', 'n\n'));
  assert.equal(
    decision(`git merge --no-ff origin/${BRANCH}`, provenAt(f.ctx, f.head)),
    'deny',
    'a newer origin',
  );

  // A name that does not resolve.
  f = fixture();
  assert.equal(
    decision('git merge --no-ff $BRANCH', provenAt(f.ctx, f.head)),
    'deny',
    'an unresolvable operand',
  );
  assert.match(reason('git merge --no-ff $BRANCH', provenAt(f.ctx, f.head)), /names no commit here/);

  // The proven head itself, merged by name: not denied.
  f = fixture();
  assert.notEqual(
    decision(`git merge --no-ff ${BRANCH}`, provenAt(f.ctx, f.head)),
    'deny',
    'the proven head',
  );
});

test('guards a merge by commit id', () => {
  const f = fixture();
  assert.equal(decision(`git merge --no-ff ${f.head}`, f.ctx), 'deny');
});

test('pins a covered PR merge to the proven head', () => {
  const f = fixture();
  f.g('update-ref', `refs/remotes/origin/${BRANCH}`, f.head);
  const ctx = provenAt(f.ctx, f.head);
  assert.equal(decision(`gh pr merge ${BRANCH} --merge`, ctx), 'deny', 'no pin');
  assert.equal(
    decision(`gh pr merge ${BRANCH} --merge --match-head-commit 0123abcd`, ctx),
    'deny',
    'another sha',
  );
  assert.match(reason(`gh pr merge ${BRANCH} --merge`, ctx), /--match-head-commit/);
  assert.notEqual(
    decision(`gh pr merge ${BRANCH} --merge --match-head-commit ${f.head}`, ctx),
    'deny',
    'the pinned head',
  );

  const g = fixture();
  g.g('update-ref', `refs/remotes/origin/${BRANCH}`, g.newCommitOn('newer', 'n\n'));
  assert.equal(
    decision(`gh pr merge ${BRANCH} --merge --match-head-commit ${g.head}`, provenAt(g.ctx, g.head)),
    'deny',
    'origin points to a newer commit',
  );
});

test('denies auto-merge of a covered branch', () => {
  const f = fixture();
  f.g('update-ref', `refs/remotes/origin/${BRANCH}`, f.head);
  assert.equal(
    decision(`gh pr merge ${BRANCH} --merge --match-head-commit ${f.head} --auto`, provenAt(f.ctx, f.head)),
    'deny',
  );
});

test('denies other ways to bring a covered branch in', () => {
  const f = fixture();
  const ctx = provenAt(f.ctx, f.head);
  for (const cmd of [
    `git cherry-pick ${BRANCH}`,
    `git rebase ${BRANCH}`,
    `git pull origin ${BRANCH}`,
    `git reset --hard ${BRANCH}`,
    `git branch -f phase/F0 ${BRANCH}`,
    `git checkout ${BRANCH} -- .claude/hooks/gate.mjs`,
    `git restore --source ${BRANCH} .claude/hooks`,
  ]) {
    assert.equal(decision(cmd, ctx), 'deny', cmd);
    assert.ok(reason(cmd, ctx).includes(`git merge --no-ff ${BRANCH}`), `${cmd} → ${reason(cmd, ctx)}`);
  }
});

test('keeps reading and switching to a covered branch', () => {
  const f = fixture();
  const ctx = provenAt(f.ctx, f.head);
  for (const cmd of [
    `git log phase/F0..${BRANCH}`,
    `git diff phase/F0 ${BRANCH}`,
    `git switch ${BRANCH}`,
    `git push -u origin ${BRANCH}`,
  ]) {
    assert.notEqual(decision(cmd, ctx), 'deny', cmd);
  }
});

test('asks for patches and plumbing', () => {
  const f = fixture();
  for (const cmd of [
    'git apply /tmp/gate.patch',
    'git am /tmp/0001-gate.patch',
    'patch -p1 < /tmp/gate.patch',
    `git read-tree ${BRANCH}`,
    'git update-ref refs/heads/phase/F0 0123abcd',
    'git update-index --cacheinfo 100644,0123abcd,a.js',
    `git fetch origin ${BRANCH}:phase/F0`,
  ]) {
    assert.equal(decision(cmd, f.ctx), 'ask', cmd);
  }
});

test('lets a proven covered branch merge', () => {
  const f = fixture();
  f.g('update-ref', `refs/remotes/origin/${BRANCH}`, f.head);
  const ctx = provenAt(f.ctx, f.head);
  assert.equal(decision(`gh pr merge ${BRANCH} --merge --match-head-commit ${f.head}`, ctx), 'none');
  assert.equal(decision(`git merge --no-ff ${BRANCH}`, ctx), 'none');
});

test('denies a merge or pull with no operand', () => {
  const f = fixture();
  for (const cmd of ['git merge', 'git pull', 'git pull origin']) {
    assert.equal(decision(cmd, f.ctx), 'deny', cmd);
    assert.match(reason(cmd, f.ctx), /name the branch/, cmd);
  }
  assert.notEqual(decision('git merge --abort', f.ctx), 'deny');
  assert.notEqual(decision('git merge --continue', f.ctx), 'deny');
});

test('denies an unresolvable PR merge operand while a feature is covered', () => {
  // `foo` was pushed from the covered head and deleted locally: only its remote ref remains.
  const f = fixture();
  f.g('update-ref', 'refs/remotes/origin/foo', f.head);
  assert.equal(decision('gh pr merge foo --merge', f.ctx), 'deny', 'a pushed, deleted branch');
  // A name that exists nowhere: the reason tells the runner to fetch or push it.
  assert.equal(decision('gh pr merge gone --merge', f.ctx), 'deny', 'a name that resolves nowhere');
  assert.match(reason('gh pr merge gone --merge', f.ctx), /git fetch origin gone or push it first/);
});

test('leaves an unresolvable operand alone with no covered feature', () => {
  const f = fixture();
  // The brief no longer ticks harness-self: no feature is covered.
  writeFileSync(
    path.join(f.dir, '.specs/phases/F0/brief.md'),
    BRIEF.replace('- [x] harness-self', '- [ ] harness-self'),
  );
  assert.equal(decision('gh pr merge gone --merge', f.ctx), 'none', 'a PR merge');
  assert.equal(decision('git merge --no-ff gone', f.ctx), 'none', 'a local merge');
});

// A brief that covers the existing `gate-precision` and a second feature whose branch does not exist yet.
const BRIEF_TWO = BRIEF.replace(
  '| gate-precision | Large |',
  '| gate-precision | Large |\n| continuous-delivery | Medium |',
).replace('`gate-precision` (ADR 028)', '`gate-precision`, `continuous-delivery` (ADR 028)');

test('a covered branch not started touches nothing', () => {
  const f = fixture();
  writeFileSync(path.join(f.dir, '.specs/phases/F0/brief.md'), BRIEF_TWO);
  // feat/F0-continuous-delivery does not exist: creating it from the phase branch brings in no covered commit.
  assert.equal(
    decision(
      'git worktree add .claude/worktrees/continuous-delivery -b feat/F0-continuous-delivery phase/F0',
      f.ctx,
    ),
    'none',
    'git worktree add',
  );
  assert.equal(decision('git branch feat/F0-continuous-delivery phase/F0', f.ctx), 'none', 'git branch');
});

test('still guards a covered branch that exists', () => {
  const f = fixture();
  writeFileSync(path.join(f.dir, '.specs/phases/F0/brief.md'), BRIEF_TWO);
  // feat/F0-gate-precision exists and holds a commit beyond the phase: naming it as an operand is still judged.
  assert.equal(
    decision(`git worktree add .claude/worktrees/x -b newer ${BRANCH}`, f.ctx),
    'deny',
    'a branch operand naming the existing covered branch',
  );
  assert.equal(decision(`git branch -f phase/F0 ${BRANCH}`, f.ctx), 'deny', 'a forced branch move');
  assert.equal(decision(`git merge --no-ff ${BRANCH}`, f.ctx), 'deny', 'a merge without proofs');
  // An operand that resolves nowhere is still denied while a feature is covered.
  assert.equal(decision('git merge --no-ff feat/F0-nope', f.ctx), 'deny', 'an unresolvable merge operand');
  assert.match(reason('git merge --no-ff feat/F0-nope', f.ctx), /names no commit here/);
});

test('guards a covered branch that exists only on the remote', () => {
  // The covered branch lives on as origin/<branch> alone: its local branch is deleted, its commit beyond the phase kept.
  const f = fixture();
  f.g('update-ref', `refs/remotes/origin/${BRANCH}`, f.head);
  f.g('branch', '-D', BRANCH);
  const ctx = f.ctx;
  for (const cmd of [
    `git merge --no-ff origin/${BRANCH}`,
    `git merge refs/remotes/origin/${BRANCH}`,
    `git pull origin ${BRANCH}`,
    `gh pr merge ${BRANCH} --merge`,
    `git cherry-pick origin/${BRANCH}`,
  ]) {
    assert.equal(decision(cmd, ctx), 'deny', cmd);
  }
  // Its proofs at the remote head count: the merge of that head is not denied.
  assert.equal(
    decision(`git merge --no-ff origin/${BRANCH}`, provenAt(ctx, f.head)),
    'none',
    'proven at origin',
  );
});

test('fails closed when git cannot answer', () => {
  // The phase branch does not resolve: a covered branch that does not exist yet still touches the merged ref.
  const f = fixture();
  writeFileSync(path.join(f.dir, '.specs/phases/F0/brief.md'), BRIEF_TWO);
  f.g('branch', '-D', BRANCH);
  f.g('branch', '-D', 'phase/F0');
  assert.equal(decision('git merge --no-ff main', f.ctx), 'deny', 'a merge naming a ref');
  assert.match(reason('git merge --no-ff main', f.ctx), /continuous-delivery|gate-precision/);
});

test('the guard reads both the local and the remote head', () => {
  const origin = `origin/${BRANCH}`;

  // The local branch sits at the phase head; origin is ahead with a gate-touching commit.
  let f = fixture();
  f.g('branch', '-f', BRANCH, 'phase/F0');
  f.g('update-ref', `refs/remotes/${origin}`, f.head);
  assert.equal(decision(`git merge --no-ff ${origin}`, f.ctx), 'deny', 'origin ahead, no proof');
  assert.ok(
    reason(`git merge --no-ff ${origin}`, f.ctx).includes(f.head),
    'the proof is due at the origin head',
  );

  // Local is ahead of origin: the proof is due at the local head, and a proof at origin alone does not count.
  f = fixture();
  f.g('update-ref', `refs/remotes/${origin}`, f.base);
  assert.equal(decision(`git merge --no-ff ${BRANCH}`, f.ctx), 'deny', 'local ahead, no proof');
  assert.ok(
    reason(`git merge --no-ff ${BRANCH}`, f.ctx).includes(f.head),
    'the proof is due at the local head',
  );
  assert.equal(
    decision(`git merge --no-ff ${BRANCH}`, provenAt(f.ctx, f.base)),
    'deny',
    'a proof at origin only',
  );
  assert.equal(decision(`git merge --no-ff ${BRANCH}`, provenAt(f.ctx, f.head)), 'none', 'a proof at local');

  // Local and origin diverged: each has its own commit on the phase head, so the merge is denied with both heads.
  f = fixture();
  f.g('checkout', '-q', '-b', 'side', f.base);
  writeFileSync(path.join(f.dir, 'side.txt'), 's\n');
  f.g('add', '.');
  f.g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'side');
  const side = f.g('rev-parse', 'HEAD');
  f.g('checkout', '-q', 'main');
  f.g('update-ref', `refs/remotes/${origin}`, side);
  for (const ref of [BRANCH, origin]) {
    assert.equal(decision(`git merge --no-ff ${ref}`, f.ctx), 'deny', `diverged, merging ${ref}`);
    const why = reason(`git merge --no-ff ${ref}`, f.ctx);
    assert.ok(why.includes(f.head) && why.includes(side), `both heads named: ${why}`);
  }
  assert.equal(
    decision(`git merge --no-ff ${BRANCH}`, provenAt(f.ctx, f.head)),
    'deny',
    'diverged with a proof',
  );

  // Origin is ahead and the proof sits at its head: the merge is allowed.
  f = fixture();
  f.g('branch', '-f', BRANCH, 'phase/F0');
  f.g('update-ref', `refs/remotes/${origin}`, f.head);
  assert.equal(
    decision(`git merge --no-ff ${origin}`, provenAt(f.ctx, f.head)),
    'none',
    'proof at the larger head',
  );

  // T27: only one of the two commit lists fails, local or origin: the merge fails closed and demands proof at the head.
  const failingList = (ctx, range) => {
    const git = ctx.git;
    ctx.git = (...args) => (args[0] === 'rev-list' && args[1] === range ? null : git(...args));
    return ctx;
  };
  for (const range of [`phase/F0..${origin}`, `phase/F0..${BRANCH}`]) {
    f = fixture();
    f.g('update-ref', `refs/remotes/${origin}`, f.head);
    const ctx = failingList(f.ctx, range);
    assert.equal(decision(`git merge --no-ff ${BRANCH}`, ctx), 'deny', `the list ${range} fails`);
    assert.ok(reason(`git merge --no-ff ${BRANCH}`, ctx).includes(f.head), `the proof is due at ${f.head}`);
  }

  // T27: a covered branch that exists only on origin is merged at its proven head, and not without proof.
  f = fixture();
  f.g('update-ref', `refs/remotes/${origin}`, f.head);
  f.g('branch', '-D', BRANCH);
  assert.equal(decision(`git merge --no-ff ${origin}`, f.ctx), 'deny', 'origin only, no proof');
  assert.equal(
    decision(`git merge --no-ff ${origin}`, provenAt(f.ctx, f.head)),
    'none',
    'origin only, proven',
  );

  // T27: the diverged deny tells the maintainer to push or fetch the branch, by name, until both heads agree.
  f = fixture();
  f.g('checkout', '-q', '-b', 'side', f.base);
  writeFileSync(path.join(f.dir, 'side.txt'), 's\n');
  f.g('add', '.');
  f.g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'side');
  const sideHead = f.g('rev-parse', 'HEAD');
  f.g('checkout', '-q', 'main');
  f.g('update-ref', `refs/remotes/${origin}`, sideHead);
  for (const ref of [BRANCH, origin]) {
    const why = reason(`git merge --no-ff ${ref}`, f.ctx);
    assert.ok(why.includes(`push or fetch ${BRANCH} until`), `the advice names the branch: ${why}`);
  }
});

test('touches only through a shared commit', () => {
  // A branch off the phase with its own commit, sharing no commit with the covered branch, is not the covered branch.
  const f = fixture();
  f.g('checkout', '-q', '-b', 'own', f.base);
  writeFileSync(path.join(f.dir, 'own.txt'), 'o\n');
  f.g('add', '.');
  f.g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'own');
  f.g('checkout', '-q', 'main');
  assert.equal(decision('git merge --no-ff own', f.ctx), 'none', 'a branch sharing no commit');
});
