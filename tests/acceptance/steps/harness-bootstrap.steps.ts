// Acceptance steps for harness-bootstrap (ADR 023, ADR 028), one step per line of acceptance.feature. Black box: a
// temporary git repository holds the phase brief and the branches, and the hooks of this worktree run as child
// processes with CLAUDE_PROJECT_DIR set to that repository. The gate gets the tool call on stdin and answers on stdout.
// Nothing here imports .claude/hooks/lib (rule acceptance-is-black-box).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, type Scenario } from '../fixtures.ts';

const maxOutputBytes = 16 * 1024 * 1024;
const hookTimeoutMs = 120_000;
const sessionId = 'harness-bootstrap-acceptance';

// The gate's answer to one tool call: the decision it gives (none when it prints nothing) and its reason.
interface Answer {
  decision: string | undefined;
  reason: string;
}

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface BootstrapWorld {
  repo: string | undefined;
  temporary: string[];
  answer: Answer | undefined;
}

const KEY = 'harness-bootstrap';

function worldOf(scenario: Scenario): BootstrapWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as BootstrapWorld;
  const created: BootstrapWorld = { repo: undefined, temporary: [], answer: undefined };
  scenario.values.set(KEY, created);
  return created;
}

function requireRepo(world: BootstrapWorld): string {
  if (world.repo === undefined) throw new Error('no temporary repository is set up in this scenario');
  return world.repo;
}

function requireAnswer(world: BootstrapWorld): Answer {
  if (world.answer === undefined) throw new Error('the gate has not been asked in this scenario');
  return world.answer;
}

// The environment without the GIT_* variables a git hook exports: a child git must act on its own repository.
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
    maxBuffer: maxOutputBytes,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

function commit(cwd: string, message: string): void {
  git(cwd, [
    '-c',
    'user.name=d2rmm acceptance',
    '-c',
    'user.email=acceptance@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  ]);
}

function branchExists(cwd: string, name: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  return result.status === 0;
}

// The phase brief the gate reads from the main checkout: an approval line, and a Delegation section with the scopes
// unticked. Every scope a scenario needs is ticked by its own Given step.
function briefOf(phase: string): string {
  return [
    `# Phase ${phase} brief`,
    '',
    `**Approved**: 2026-11-07 - user: "aprovo specs e tasks da ${phase} que passarem nos gates automáticos" (delegated via .specs/phases/${phase}/brief.md)`,
    '',
    '## Delegation',
    '',
    '- [ ] harness-self',
    '- [ ] local-merge-phase-branch',
    '',
  ].join('\n');
}

// The hook of this worktree (`<repo>/.claude/hooks/gate.mjs`) answers one tool call, run in the temporary repository.
function askGate(scenario: Scenario, payload: Record<string, unknown>): Answer {
  const repo = requireRepo(worldOf(scenario));
  const hook = path.join(scenario.repoRoot, '.claude', 'hooks', 'gate.mjs');
  const env = { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo };
  const result = spawnSync(process.execPath, [hook], {
    cwd: repo,
    input: JSON.stringify({ session_id: sessionId, cwd: repo, hook_event_name: 'PreToolUse', ...payload }),
    encoding: 'utf8',
    env,
    maxBuffer: maxOutputBytes,
    timeout: hookTimeoutMs,
  });
  if (result.status !== 0) {
    throw new Error(`gate.mjs exited ${result.status}\n${result.stderr}`);
  }
  const text = result.stdout.trim();
  if (text === '') return { decision: undefined, reason: '' };
  const output =
    (JSON.parse(text) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  return {
    decision: typeof output['permissionDecision'] === 'string' ? output['permissionDecision'] : undefined,
    reason: typeof output['permissionDecisionReason'] === 'string' ? output['permissionDecisionReason'] : '',
  };
}

Given(/^a temporary repository with an approved phase brief for "(F\d+)"$/, ({ scenario }, phase: string) => {
  const world = worldOf(scenario);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-hbs-'));
  world.temporary.push(dir);
  world.repo = dir;
  git(dir, ['init', '-q', '-b', 'main']);
  mkdirSync(path.join(dir, '.specs', 'phases', phase), { recursive: true });
  writeFileSync(path.join(dir, '.specs', 'phases', 'ACTIVE'), `${phase}\n`, 'utf8');
  writeFileSync(path.join(dir, '.specs', 'phases', phase, 'brief.md'), briefOf(phase), 'utf8');
  git(dir, ['add', '-A']);
  commit(dir, `chore: phase ${phase} brief`);
  git(dir, ['branch', `phase/${phase}`]);
});

Given(/^the current branch is "(.+)"$/, ({ scenario }, branch: string) => {
  const dir = requireRepo(worldOf(scenario));
  if (branchExists(dir, branch)) git(dir, ['checkout', '-q', branch]);
  else git(dir, ['checkout', '-q', '-b', branch]);
});

When(/^the agent asks the gate to run "(.+)"$/, ({ scenario }, command: string) => {
  const world = worldOf(scenario);
  world.answer = askGate(scenario, { tool_name: 'Bash', tool_input: { command } });
});

Then(/^the gate answers "(allow|ask|deny)"$/, ({ scenario }, decision: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.decision, `gate decision (reason: ${answer.reason})`).toBe(decision);
});

Then(/^the gate does not answer "(allow|ask|deny)"$/, ({ scenario }, decision: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.decision, `gate decision (reason: ${answer.reason})`).not.toBe(decision);
});

Then(/^the reason names "(.+)"$/, ({ scenario }, text: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.reason, 'the gate reason').toContain(text);
});

After(({ scenario }) => {
  const stored = scenario.values.get(KEY) as BootstrapWorld | undefined;
  for (const dir of stored?.temporary ?? []) rmSync(dir, { recursive: true, force: true });
});
