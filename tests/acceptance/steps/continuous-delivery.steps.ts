// Acceptance steps for continuous-delivery (ADR 023, ADR 028), one step per line of acceptance.feature. Black box: a
// temporary git repository holds the phase brief, the feature files, the commits and the decisions file, and
// scripts/phase-status.mjs of this checkout runs in it as a child process. Every GIT_* variable and the ledger override
// are cleared for the children, so each git acts on its own repository. Nothing here imports scripts/lib (rule
// acceptance-is-black-box).
//
// "The line of a feature" is the line phase-status prints for it and the maintainer items printed under that line
// (CDL-09); "the phase line" is the phase's line and the items printed under it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, type Scenario } from '../fixtures.ts';

const KEY = 'continuous-delivery';
const PHASE = 'F0';
const PHASE_REF = `refs/heads/phase/${PHASE}`;
const BRIEF_FEATURES = ['alpha', 'beta', 'gamma'];
const ASKED_ON = '2026-11-08';
const maxOutputBytes = 16 * 1024 * 1024;
const approvalWords = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
const briefApproval = `**Approved**: 2026-11-07 - user: "${approvalWords}"`;
const featureApproval = `**Approved**: 2026-11-08 - user: "${approvalWords}" (delegated via .specs/phases/F0/brief.md)`;

// One feature as phase-status --json reports it: the fields the steps read.
interface FeatureState {
  feature: string;
  status: string;
  next: string;
  reason: string | null;
  items: { item: string }[];
}

// What phase-status says about the phase: its JSON state and its text output.
interface Answer {
  state: { next: string; features: FeatureState[]; phaseItems: { feature: string; item: string }[] };
  text: string;
}

// One row of decisions.md → "## For the maintainer".
interface Row {
  feature: string;
  item: string;
  answer: string;
}

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface DeliveryWorld {
  repo: string | undefined;
  rows: Row[];
  verified: Map<string, string>;
  answer: Answer | undefined;
}

function worldOf(scenario: Scenario): DeliveryWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as DeliveryWorld;
  const created: DeliveryWorld = {
    repo: undefined,
    rows: [],
    verified: new Map<string, string>(),
    answer: undefined,
  };
  scenario.values.set(KEY, created);
  return created;
}

function repoOf(world: DeliveryWorld): string {
  if (world.repo === undefined) throw new Error('no temporary repository is set up in this scenario');
  return world.repo;
}

// The environment without the GIT_* variables a git hook exports, and without the ledger override.
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'D2RMM_LEDGER'),
  );
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=d2rmm acceptance',
      '-c',
      'user.email=acceptance@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${os.devNull}`,
      ...args,
    ],
    { cwd, encoding: 'utf8', env: cleanEnv(), maxBuffer: maxOutputBytes },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function write(repo: string, rel: string, text: string): void {
  const file = path.join(repo, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function treeOf(repo: string, rev: string): string {
  return git(repo, ['rev-parse', `${rev}^{tree}`]);
}

// A commit with the given tree and parents. Nothing is checked out: the working tree keeps the phase's files.
function commitOn(repo: string, parents: string[], tree: string, message: string): string {
  const parentArgs = parents.flatMap((parent) => ['-p', parent]);
  return git(repo, ['commit-tree', tree, ...parentArgs, '-m', message]);
}

function phaseHead(repo: string): string {
  return git(repo, ['rev-parse', '--verify', PHASE_REF]);
}

function setPhaseHead(repo: string, sha: string): void {
  git(repo, ['update-ref', PHASE_REF, sha]);
}

// The brief: the three features, gamma after alpha, and the approval the gate reads.
function briefText(): string {
  return [
    `# Phase ${PHASE} brief`,
    '',
    '## Features',
    '',
    '| Feature | Size | Depends on | Parallel | Covers | Wall-clock |',
    '| --- | --- | --- | --- | --- | --- |',
    '| alpha | Small | — | yes | FR-01 | default |',
    '| beta | Small | — | yes | FR-02 | default |',
    '| gamma | Small | alpha | yes | FR-03 | default |',
    '',
    '## Approval',
    '',
    briefApproval,
    '',
  ].join('\n');
}

function writeDecisions(repo: string, rows: Row[]): void {
  write(
    repo,
    `.specs/phases/${PHASE}/decisions.md`,
    [
      `# Phase ${PHASE} — decisions queue`,
      '',
      '## For the maintainer',
      '',
      '| Feature | Item | Asked | Answer |',
      '| ------- | ---- | ----- | ------ |',
      ...rows.map((row) => `| ${row.feature} | ${row.item} | ${ASKED_ON} | ${row.answer} |`),
      '',
    ].join('\n'),
  );
}

// The feature's files of Specify, Tasks and Execute, and its two commits: the task commit and the verification
// commit. The branch feat/F0-<feature> holds the verification commit; nothing reaches the phase branch yet.
function verifyFeature(repo: string, feature: string): string {
  write(repo, `.specs/features/${feature}/spec.md`, `# ${feature}\n\n${featureApproval}\n`);
  write(repo, `.specs/features/${feature}/acceptance.feature`, `Feature: ${feature}\n`);
  write(
    repo,
    `.specs/features/${feature}/tasks.md`,
    `# Tasks\n\n${featureApproval}\n\n### T1: ${feature} work\n`,
  );
  write(repo, `.specs/features/${feature}/proofs.md`, 'proofs\n');
  write(repo, `.specs/features/${feature}/verification.md`, 'verification\n');
  const base = git(repo, ['rev-parse', 'refs/heads/main']);
  const task = commitOn(
    repo,
    [base],
    treeOf(repo, base),
    `feat: ${feature}\n\nFeature: ${feature}\nTask: T1`,
  );
  const verified = commitOn(
    repo,
    [task],
    treeOf(repo, task),
    `docs(${feature}): verified\n\nFeature: ${feature}\nStep: verification`,
  );
  git(repo, ['update-ref', `refs/heads/feat/${PHASE}-${feature}`, verified]);
  return verified;
}

// A merge commit on the phase branch: the feature's commits, the trailers among them, become reachable from it.
function mergeIntoPhase(repo: string, verified: string, feature: string): void {
  const head = phaseHead(repo);
  setPhaseHead(
    repo,
    commitOn(
      repo,
      [head, verified],
      treeOf(repo, head),
      `Merge pull request #1 from feat/${PHASE}-${feature}`,
    ),
  );
}

// A squash commit on the phase branch: one commit with no trailers, the feature's verification commit not reachable.
function squashIntoPhase(repo: string, feature: string): void {
  const head = phaseHead(repo);
  setPhaseHead(
    repo,
    commitOn(repo, [head], treeOf(repo, head), `feat(${feature}): ${feature} in one commit (#2)`),
  );
}

// A repository on the phase branch, whose one commit holds the approved brief. The branch main holds the base commit.
function buildRepo(world: DeliveryWorld): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-continuous-delivery-'));
  world.repo = repo;
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['commit', '--allow-empty', '-q', '-m', 'chore: start']);
  git(repo, ['checkout', '-q', '-b', `phase/${PHASE}`]);
  write(repo, `.specs/phases/${PHASE}/brief.md`, briefText());
  write(repo, '.specs/phases/ACTIVE', `${PHASE}\n`);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', `chore(specs): brief ${PHASE}`]);
  return repo;
}

// phase-status of this checkout, run in the temporary repository. The text output and the JSON state are both kept.
function runStatus(scenario: Scenario, repo: string, extra: string[]): string {
  const script = path.join(scenario.repoRoot, 'scripts', 'phase-status.mjs');
  const result = spawnSync(process.execPath, [script, PHASE, ...extra], {
    cwd: repo,
    encoding: 'utf8',
    env: cleanEnv(),
    maxBuffer: maxOutputBytes,
  });
  if (result.status !== 0) throw new Error(`phase-status exited ${result.status}\n${result.stderr}`);
  return result.stdout;
}

function ask(scenario: Scenario, repo: string): Answer {
  return { state: JSON.parse(runStatus(scenario, repo, ['--json'])), text: runStatus(scenario, repo, []) };
}

// The answer of phase-status as of the last step that changed the repository, asked now when none is kept.
function answerOf(scenario: Scenario): Answer {
  const world = worldOf(scenario);
  if (world.answer === undefined) world.answer = ask(scenario, repoOf(world));
  return world.answer;
}

function changed(scenario: Scenario): void {
  worldOf(scenario).answer = undefined;
}

function featureOf(answer: Answer, name: string): FeatureState {
  const found = answer.state.features.find((state) => state.feature === name);
  if (found === undefined) throw new Error(`phase-status lists no feature "${name}"`);
  return found;
}

// The line phase-status prints for a feature, and the maintainer items printed under it (six spaces).
function lineOfFeature(text: string, name: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex(
    (line) => /^ {2}\S/u.test(line) && line.includes(' next: ') && line.trim().split(/\s+/u)[1] === name,
  );
  if (start < 0) throw new Error(`phase-status prints no line for "${name}"`);
  const block = [lines[start] ?? ''];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('      ')) break;
    block.push(line);
  }
  return block;
}

// The phase line and the lines under it, up to the first feature line.
function lineOfPhase(text: string): string[] {
  const lines = text.split('\n');
  const head = lines.findIndex((line) => line.startsWith(`phase ${PHASE}:`));
  if (head < 0) throw new Error(`phase-status prints no phase line for ${PHASE}`);
  const block = [lines[head] ?? ''];
  for (const line of lines.slice(head + 1)) {
    if (line.includes(' next: ') || line.trim() === '') break;
    block.push(line);
  }
  return block;
}

After(({ scenario }) => {
  const stored = scenario.values.get(KEY) as DeliveryWorld | undefined;
  if (stored?.repo !== undefined) rmSync(stored.repo, { recursive: true, force: true });
});

Given(
  /^a temporary repository with an approved phase brief for "(F\d+)" listing "alpha", "beta" and "gamma" after "alpha"$/,
  ({ scenario }, phase: string) => {
    if (phase !== PHASE) throw new Error(`the scenarios use ${PHASE}, not ${phase}`);
    const world = worldOf(scenario);
    buildRepo(world);
    changed(scenario);
  },
);

Given(/^the feature "([^"]+)" is verified on its branch$/, ({ scenario }, feature: string) => {
  const world = worldOf(scenario);
  world.verified.set(feature, verifyFeature(repoOf(world), feature));
  changed(scenario);
});

Given('every feature of the phase is done', ({ scenario }) => {
  const world = worldOf(scenario);
  const repo = repoOf(world);
  for (const feature of BRIEF_FEATURES) {
    mergeIntoPhase(repo, verifyFeature(repo, feature), feature);
  }
  changed(scenario);
});

Given(
  /^the phase review exists (with no approval line|with the maintainer's approval line)$/,
  ({ scenario }, form: string) => {
    const approval =
      form === 'with no approval line' ? '' : `\n**Approved**: 2026-11-20 - user: "${approvalWords}"\n`;
    write(
      repoOf(worldOf(scenario)),
      `.specs/phases/${PHASE}/review.md`,
      `# Phase ${PHASE} — review\n\nThe gates passed.\n${approval}`,
    );
    changed(scenario);
  },
);

Given(
  /^the decisions file asks the maintainer "([^"]+)" for the feature "([^"]+)"$/,
  ({ scenario }, item: string, feature: string) => {
    const world = worldOf(scenario);
    world.rows.push({ feature, item, answer: '' });
    writeDecisions(repoOf(world), world.rows);
    changed(scenario);
  },
);

Given(/^the maintainer answered it "([^"]*)"$/, ({ scenario }, answer: string) => {
  const world = worldOf(scenario);
  const last = world.rows[world.rows.length - 1];
  if (last === undefined) throw new Error('the decisions file asks nothing in this scenario');
  last.answer = answer;
  writeDecisions(repoOf(world), world.rows);
  changed(scenario);
});

When(
  /^its branch reaches the phase branch through (a merge commit|a squash commit with no trailers)$/,
  ({ scenario }, how: string) => {
    const world = worldOf(scenario);
    const feature = BRIEF_FEATURES.find((name) => world.verified.has(name));
    if (feature === undefined) throw new Error('no feature is verified on its branch in this scenario');
    const repo = repoOf(world);
    if (how === 'a merge commit') mergeIntoPhase(repo, world.verified.get(feature) ?? '', feature);
    else squashIntoPhase(repo, feature);
    changed(scenario);
  },
);

When(/^the phase branch is merged into main$/, ({ scenario }) => {
  const repo = repoOf(worldOf(scenario));
  git(repo, ['update-ref', 'refs/heads/main', phaseHead(repo)]);
  changed(scenario);
});

When(/^the phase branch is merged into origin\/main only$/, ({ scenario }) => {
  const repo = repoOf(worldOf(scenario));
  git(repo, ['update-ref', 'refs/remotes/origin/main', phaseHead(repo)]);
  changed(scenario);
});

When(/^the agent asks phase-status for the phase$/, ({ scenario }) => {
  const world = worldOf(scenario);
  world.answer = ask(scenario, repoOf(world));
});

Then(
  /^phase-status reports the feature "([^"]+)" as "([^"]+)"$/,
  ({ scenario }, feature: string, state: string) => {
    expect(featureOf(answerOf(scenario), feature).next, `the next step of ${feature}`).toBe(state);
  },
);

Then(/^the phase step is "([^"]+)"$/, ({ scenario }, step: string) => {
  expect(answerOf(scenario).state.next, 'the phase step').toBe(step);
});

Then(
  /^the feature "([^"]+)" is "([^"]+)" with the reason "([^"]+)"$/,
  ({ scenario }, feature: string, status: string, reason: string) => {
    const found = featureOf(answerOf(scenario), feature);
    expect(found.status, `the status of ${feature}`).toBe(status);
    expect(found.reason, `the reason of ${feature}`).toBe(reason);
  },
);

Then(/^the feature "([^"]+)" is "([^"]+)"$/, ({ scenario }, feature: string, status: string) => {
  expect(featureOf(answerOf(scenario), feature).status, `the status of ${feature}`).toBe(status);
});

Then(/^the line of the feature "([^"]+)" shows "([^"]+)"$/, ({ scenario }, feature: string, text: string) => {
  expect(lineOfFeature(answerOf(scenario).text, feature).join('\n'), `the line of ${feature}`).toContain(
    text,
  );
});

Then(/^the phase line shows "([^"]+)"$/, ({ scenario }, text: string) => {
  expect(lineOfPhase(answerOf(scenario).text).join('\n'), 'the phase line').toContain(text);
});
