// CDL-09 and CDL-17 (continuous-delivery): `phase-status` runs as a child process against temporary repositories.
// Every GIT_* variable and the ledger override are cleared; nothing is written outside the temporary directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(checkout, 'scripts', 'phase-status.mjs');
const W = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const APPROVED = `**Approved**: 2026-11-03 - user: "${W}" (delegated via .specs/phases/F0/brief.md)`;
const BRIEF_ROWS = [
  '| alpha | Small | — | no | FR-01 | default |',
  '| beta | Small | — | yes | FR-02 | default |',
];
const brief = (rows) =>
  [
    '# F0',
    '',
    '## Features',
    '',
    '| Feature | Size | Depends on | Parallel | Covers | Wall-clock |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Approval',
    '',
    `**Approved**: 2026-11-02 - user: "${W}"`,
    '',
  ].join('\n');

function cleanEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'D2RMM_LEDGER'),
  );
}

function git(cwd, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${os.devNull}`,
      ...args,
    ],
    { cwd, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function write(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}

function commit(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

// A repository on phase/F0 with a brief, and alpha verified and integrated into the phase branch.
function doneRepo(root) {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '--allow-empty', '-q', '-m', 'chore: start');
  git(root, 'checkout', '-q', '-b', 'phase/F0');
  write(root, '.specs/phases/F0/brief.md', brief(BRIEF_ROWS.slice(0, 1)));
  commit(root, 'chore(specs): brief F0');
  write(root, '.specs/features/alpha/spec.md', `# spec\n\n${APPROVED}\n`);
  write(root, '.specs/features/alpha/acceptance.feature', 'Feature: alpha\n');
  write(root, '.specs/features/alpha/tasks.md', `# Tasks\n\n${APPROVED}\n\n### T1: alpha work\n`);
  commit(root, 'feat: alpha\n\nFeature: alpha\nTask: T1');
  write(root, '.specs/features/alpha/proofs.md', 'proofs\n');
  write(root, '.specs/features/alpha/verification.md', 'verification\n');
  commit(root, 'docs(alpha): verified\n\nFeature: alpha\nStep: verification');
  write(root, '.specs/phases/F0/review.md', '# Review F0\n\nThe gates passed. No approval line.\n');
  commit(root, 'docs(specs): review F0');
}

function runCli(root, ...args) {
  const run = spawnSync(process.execPath, [script, 'F0', ...args], {
    cwd: root,
    env: cleanEnv(),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function withRepo(build, body) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'phase-status-cli-'));
  try {
    build(root);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// CDL-17: a phase merged only into origin/main is merged into main, though the local main is behind.
test('reads a merge on origin/main', () => {
  withRepo(doneRepo, (root) => {
    assert.match(runCli(root), /phase F0: next = merge\b/u, 'the local main does not hold the phase yet');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'phase/F0');
    assert.match(runCli(root), /phase F0: next = closed\b/u, 'origin/main holds the phase');
  });
});

// CDL-09: an open maintainer item prints under its feature's line; an item for a feature not in the brief prints under
// the phase line; --json carries reason, items and phaseItems.
test('prints open maintainer items', () => {
  withRepo(
    (root) => {
      git(root, 'init', '-q', '-b', 'main');
      git(root, 'commit', '--allow-empty', '-q', '-m', 'chore: start');
      git(root, 'checkout', '-q', '-b', 'phase/F0');
      write(root, '.specs/phases/F0/brief.md', brief(BRIEF_ROWS));
      write(
        root,
        '.specs/phases/F0/decisions.md',
        [
          '# Decisions',
          '',
          '## For the maintainer',
          '',
          '| Feature | Item | Asked | Answer |',
          '| --- | --- | --- | --- |',
          '| alpha | Create the TURSO_TOKEN secret | 2026-11-08 |  |',
          '| alpha | Apply the main ruleset | 2026-11-08 |  |',
          '| omega | Pay for a larger runner | 2026-11-08 |  |',
          '',
        ].join('\n'),
      );
      commit(root, 'chore(specs): brief F0');
    },
    (root) => {
      const lines = runCli(root).split('\n');
      const alpha = lines.findIndex((l) => /^\s*blocked\s+alpha\b/u.test(l));
      const beta = lines.findIndex((l) => /^\s*ready\s+beta\b/u.test(l));
      const tokenLine = lines.findIndex((l) => l.includes('maintainer: Create the TURSO_TOKEN secret'));
      const rulesetLine = lines.findIndex((l) => l.includes('maintainer: Apply the main ruleset'));
      assert.ok(alpha >= 0, 'alpha is blocked');
      assert.ok(beta > alpha, 'beta is ready, below alpha');
      assert.ok(tokenLine > alpha && tokenLine < beta, 'the first item prints under the line of alpha');
      assert.ok(rulesetLine > alpha && rulesetLine < beta, 'the second item prints under the line of alpha');
      const phaseLine = lines.findIndex((l) => l.startsWith('phase F0:'));
      const omegaLine = lines.findIndex((l) => l.includes('Pay for a larger runner'));
      assert.ok(
        omegaLine > phaseLine && omegaLine < alpha,
        'the item of a feature not in the brief prints under the phase line',
      );

      const state = JSON.parse(runCli(root, '--json'));
      const featureAlpha = state.features.find((f) => f.feature === 'alpha');
      assert.equal(featureAlpha.status, 'blocked');
      assert.equal(featureAlpha.reason, 'maintainer');
      assert.deepEqual(
        featureAlpha.items.map((i) => i.item),
        ['Create the TURSO_TOKEN secret', 'Apply the main ruleset'],
      );
      assert.deepEqual(
        state.phaseItems.map((i) => [i.feature, i.item]),
        [['omega', 'Pay for a larger runner']],
      );
    },
  );
});
