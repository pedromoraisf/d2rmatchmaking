// Acceptance steps for harness-bootstrap (ADR 023, ADR 028), one step per line of acceptance.feature. Black box: a
// temporary git repository holds the phase brief, the branches, the retry ledger and the verdicts, and the hooks of
// this worktree run as child processes with CLAUDE_PROJECT_DIR set to that repository. The gate gets the tool call on
// stdin and answers on stdout; the verdict hook gets the PostToolUse payload of a dispatch. Nothing here imports
// .claude/hooks/lib (rule acceptance-is-black-box).
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, type Scenario } from '../fixtures.ts';

const maxOutputBytes = 16 * 1024 * 1024;
const hookTimeoutMs = 120_000;
const sessionId = 'harness-bootstrap-acceptance';
const featureBranch = 'feat/F0-gate-precision';
const untickedHarnessSelf = '- [ ] harness-self';
const removedTestCase = "test('first case', () => {});\n";
const testFileText = `import { test } from 'node:test';\n\n${removedTestCase}test('second case', () => {});\n`;

// The gate's answer to one tool call: the decision it gives (none when it prints nothing) and its reason.
interface Answer {
  decision: string | undefined;
  reason: string;
}

// A foreground dispatch that has started and may still return: its tool_use_id and its tool input.
interface Dispatch {
  id: string;
  toolInput: Record<string, unknown>;
}

// One record of verdicts.json (ADR 028 § 3), as the hooks write it.
interface VerdictRecord {
  feature: string;
  head: string;
  verdict: string;
}

// The retry ledger as the hooks read it (ADR 022). Seeded attempts carry the fields attempt.mjs records (HBS-25).
interface LedgerFile {
  version: number;
  units: Record<string, { status: string; attempts: unknown[] }>;
}

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface BootstrapWorld {
  repo: string | undefined;
  phase: string;
  temporary: string[];
  answer: Answer | undefined;
  dispatch: Dispatch | undefined;
  dispatchHead: string | undefined;
  dispatchCount: number;
  guides: Map<string, string>;
}

const KEY = 'harness-bootstrap';

function worldOf(scenario: Scenario): BootstrapWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as BootstrapWorld;
  const created: BootstrapWorld = {
    repo: undefined,
    phase: 'F0',
    temporary: [],
    answer: undefined,
    dispatch: undefined,
    dispatchHead: undefined,
    dispatchCount: 0,
    guides: new Map<string, string>(),
  };
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

function requireDispatch(world: BootstrapWorld): Dispatch {
  if (world.dispatch === undefined) throw new Error('no foreground dispatch has started in this scenario');
  return world.dispatch;
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

function identityArgs(): string[] {
  return [
    '-c',
    'user.name=d2rmm acceptance',
    '-c',
    'user.email=acceptance@example.invalid',
    '-c',
    'commit.gpgsign=false',
  ];
}

function commit(cwd: string, message: string): void {
  git(cwd, [...identityArgs(), 'commit', '-q', '-m', message]);
}

// The sha a revision names in the repository, or undefined when it names no commit.
function revParse(cwd: string, rev: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function headOf(repo: string, branch = featureBranch): string {
  const sha = revParse(repo, `refs/heads/${branch}`);
  if (sha === undefined) throw new Error(`branch ${branch} does not exist`);
  return sha;
}

function setRef(repo: string, ref: string, sha: string): void {
  git(repo, ['update-ref', ref, sha]);
}

// A commit with the tree of `parent`, on top of `parent`. Nothing is checked out, so the current branch stays put.
function commitAfter(repo: string, parent: string, message: string): string {
  const tree = git(repo, ['rev-parse', `${parent}^{tree}`]).trim();
  return git(repo, [...identityArgs(), 'commit-tree', tree, '-p', parent, '-m', message]).trim();
}

function commitOnBranch(repo: string, branch: string, message: string): void {
  setRef(repo, `refs/heads/${branch}`, commitAfter(repo, headOf(repo, branch), message));
}

function featureOf(branch: string): string {
  const name = /^feat\/F\d+-(.+)$/.exec(branch)?.[1];
  if (!name) throw new Error(`${branch} is not a feature branch`);
  return name;
}

// The phase brief the gate reads from the main checkout: an approval line, the features of the phase, and the
// Delegation section with harness-self as given. Every scope a scenario needs is ticked by its own Given step.
function briefOf(phase: string, harnessSelf = untickedHarnessSelf): string {
  return [
    `# Phase ${phase} brief`,
    '',
    `**Approved**: 2026-11-07 - user: "aprovo specs e tasks da ${phase} que passarem nos gates automáticos" (delegated via .specs/phases/${phase}/brief.md)`,
    '',
    '## Features',
    '',
    '| Feature | Size |',
    '| --- | --- |',
    '| gate-precision | Large |',
    '| budget-v2 | Medium |',
    '',
    '## Delegation',
    '',
    harnessSelf,
    '- [ ] local-merge-phase-branch',
    '',
  ].join('\n');
}

// A ticked harness-self line that names the features it covers, in backticks, as the brief writes them.
function tickedLine(names: string[]): string {
  return `- [x] harness-self for ${names.map((name) => `\`${name}\``).join(' and ')}`;
}

function writeFile(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function mainBriefPath(repo: string, phase: string): string {
  return path.join(repo, '.specs', 'phases', phase, 'brief.md');
}

function worktreeDir(repo: string, worktree: string): string {
  return path.join(repo, '.claude', 'worktrees', worktree);
}

// Runs one hook of this worktree in the scenario's repository and returns what it printed.
function runHook(
  scenario: Scenario,
  hook: 'gate.mjs' | 'verdict.mjs',
  payload: Record<string, unknown>,
): string {
  const repo = requireRepo(worldOf(scenario));
  const script = path.join(scenario.repoRoot, '.claude', 'hooks', hook);
  const env = { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo };
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    input: JSON.stringify({ ...payload, session_id: sessionId, cwd: repo }),
    encoding: 'utf8',
    env,
    maxBuffer: maxOutputBytes,
    timeout: hookTimeoutMs,
  });
  if (result.status !== 0) throw new Error(`${hook} exited ${result.status}\n${result.stderr}`);
  return result.stdout.trim();
}

function answerOf(text: string): Answer {
  if (text === '') return { decision: undefined, reason: '' };
  const output =
    (JSON.parse(text) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  const decision = output['permissionDecision'];
  const reason = output['permissionDecisionReason'];
  return {
    decision: typeof decision === 'string' ? decision : undefined,
    reason: typeof reason === 'string' ? reason : '',
  };
}

// The gate's answer to one PreToolUse call in the scenario's repository.
function askGate(scenario: Scenario, payload: Record<string, unknown>): Answer {
  return answerOf(runHook(scenario, 'gate.mjs', { hook_event_name: 'PreToolUse', ...payload }));
}

function bashCall(command: string): Record<string, unknown> {
  return { tool_name: 'Bash', tool_input: { command } };
}

// The Edit tool's call on one file, named by the path Claude Code gives it (not normalised here: the gate resolves it).
function editCall(file: string): Record<string, unknown> {
  return { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'before', new_string: 'after' } };
}

// The Edit tool's call that removes one test case from a file.
function removeCaseCall(file: string): Record<string, unknown> {
  return { tool_name: 'Edit', tool_input: { file_path: file, old_string: removedTestCase, new_string: '' } };
}

// The prompt header of a dispatch: the feature and the step its retry budget and verdict are counted under (ADR 022).
function header(feature: string, step: string): string {
  return `[d2rmm feature=${feature} step=${step}]`;
}

// Starts a foreground dispatch: the gate notes the head of the feature branch when the review is a security review
// of a diff (HBS-26), and counts the dispatch (ADR 022).
function startDispatch(scenario: Scenario, agent: string, prompt: string): Dispatch {
  const world = worldOf(scenario);
  const repo = requireRepo(world);
  world.dispatchCount += 1;
  const dispatch: Dispatch = {
    id: `toolu_hbs_${world.dispatchCount}`,
    toolInput: { subagent_type: agent, description: 'review the diff', prompt, run_in_background: false },
  };
  runHook(scenario, 'gate.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Task',
    tool_use_id: dispatch.id,
    tool_input: dispatch.toolInput,
  });
  world.dispatch = dispatch;
  world.dispatchHead = revParse(repo, `refs/heads/${featureBranch}`);
  return dispatch;
}

// The report a reviewer returns: a body, then the ending the scenario gives. ", then a line" starts a new line.
function reportEnding(ending: string): string {
  return `The diff is reviewed.\n\n${ending.replace(', then a line ', '\n')}`;
}

// Ends a dispatch: the PostToolUse hook reads the report from the payload shape of the fixture (HBS-27 to HBS-28).
function finishDispatch(scenario: Scenario, dispatch: Dispatch, text: string): void {
  const fixture = JSON.parse(
    readFileSync(
      path.join(scenario.repoRoot, 'scripts', 'test', 'fixtures', 'hooks', 'agent-post-tool-use.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  runHook(scenario, 'verdict.mjs', {
    ...fixture,
    hook_event_name: 'PostToolUse',
    tool_use_id: dispatch.id,
    tool_input: dispatch.toolInput,
    tool_response: { content: [{ type: 'text', text }] },
  });
}

// A whole foreground security review of a diff for one feature, started and returned.
function review(scenario: Scenario, feature: string, ending: string): void {
  const dispatch = startDispatch(
    scenario,
    'security-reviewer',
    `${header(feature, 'review-diff')} review the diff`,
  );
  finishDispatch(scenario, dispatch, reportEnding(ending));
}

interface LedgerEntry {
  at: string;
  ok: boolean;
  note: string;
  command: string;
  head: string;
  clean: boolean;
}

// Seeds one passed or failed attempt of the retry ledger with the fields attempt.mjs records (HBS-25), in the
// git common directory where the hooks read it (ADR 022).
function seedAttempt(repo: string, feature: string, entry: Omit<LedgerEntry, 'at' | 'note'>): void {
  const file = path.join(repo, '.git', 'd2rmm', 'ledger.json');
  const ledger: LedgerFile = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as LedgerFile)
    : { version: 1, units: {} };
  const key = `gate:${feature}/T${Object.keys(ledger.units).length + 1}`;
  const attempt: LedgerEntry = {
    at: new Date().toISOString(),
    note: 'seeded by the acceptance steps',
    ...entry,
  };
  ledger.units[key] = { status: entry.ok ? 'passed' : 'open', attempts: [attempt] };
  writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

// A passed run of `command` at the head of `branch` (default: the feature branch), on a clean or a dirty tree.
function seedTest(repo: string, branch: string, command: string, clean: boolean): void {
  seedAttempt(repo, featureOf(branch), { command, head: headOf(repo, branch), clean, ok: true });
}

function verdictsOf(repo: string, feature: string): VerdictRecord[] {
  const file = path.join(repo, '.git', 'd2rmm', 'verdicts.json');
  if (!existsSync(file)) return [];
  const store = JSON.parse(readFileSync(file, 'utf8')) as { verdicts?: VerdictRecord[] };
  return (store.verdicts ?? []).filter((verdict) => verdict.feature === feature);
}

function expectLatestVerdict(repo: string, feature: string, head: string, verdict: string): void {
  const latest = verdictsOf(repo, feature)
    .filter((record) => record.head === head)
    .at(-1);
  expect(latest?.verdict, `latest verdict of ${feature} at ${head}`).toBe(verdict);
}

function tickBrief(scenario: Scenario, names: string[]): void {
  const world = worldOf(scenario);
  writeFile(mainBriefPath(requireRepo(world), world.phase), briefOf(world.phase, tickedLine(names)));
}

Given(/^a temporary repository with an approved phase brief for "(F\d+)"$/, ({ scenario }, phase: string) => {
  const world = worldOf(scenario);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-hbs-'));
  world.temporary.push(dir);
  world.repo = dir;
  world.phase = phase;
  git(dir, ['init', '-q', '-b', 'main']);
  mkdirSync(path.join(dir, '.specs', 'phases', phase), { recursive: true });
  writeFileSync(path.join(dir, '.specs', 'phases', 'ACTIVE'), `${phase}\n`, 'utf8');
  writeFileSync(mainBriefPath(dir, phase), briefOf(phase), 'utf8');
  git(dir, ['add', '-A']);
  commit(dir, `chore: phase ${phase} brief`);
  git(dir, ['branch', `phase/${phase}`]);
});

Given(/^the current branch is "(.+)"$/, ({ scenario }, branch: string) => {
  const dir = requireRepo(worldOf(scenario));
  if (revParse(dir, `refs/heads/${branch}`) !== undefined) git(dir, ['checkout', '-q', branch]);
  else git(dir, ['checkout', '-q', '-b', branch]);
});

Given(/^the brief ticks "harness-self" for "([^"]+)"$/, ({ scenario }, feature: string) => {
  tickBrief(scenario, [feature]);
});

Given(
  /^the brief ticks "harness-self" for "([^"]+)" and also names "([^"]+)" on that line$/,
  ({ scenario }, feature: string, named: string) => {
    tickBrief(scenario, [feature, named]);
  },
);

Given(/^the brief does not tick "harness-self"$/, ({ scenario }) => {
  const world = worldOf(scenario);
  writeFile(mainBriefPath(requireRepo(world), world.phase), briefOf(world.phase));
});

// A worktree's own copy of the brief: the gate reads the brief of the main checkout only (HBS-19).
Given(
  /^the worktree of "([^"]+)" holds a brief that ticks "harness-self" for "([^"]+)"$/,
  ({ scenario }, worktree: string, feature: string) => {
    const world = worldOf(scenario);
    const repo = requireRepo(world);
    writeFile(
      path.join(worktreeDir(repo, worktree), '.specs', 'phases', world.phase, 'brief.md'),
      briefOf(world.phase, tickedLine([feature])),
    );
  },
);

Given(
  /^the worktree of "([^"]+)" holds a symbolic link "([^"]+)" to the main checkout$/,
  ({ scenario }, worktree: string, link: string) => {
    const repo = requireRepo(worldOf(scenario));
    const dir = worktreeDir(repo, worktree);
    mkdirSync(dir, { recursive: true });
    symlinkSync(repo, path.join(dir, link), 'dir');
  },
);

Given(/^the branch "([^"]+)" exists$/, ({ scenario }, branch: string) => {
  const repo = requireRepo(worldOf(scenario));
  if (revParse(repo, `refs/heads/${branch}`) !== undefined) return;
  const phaseHead = headOf(repo, `phase/${worldOf(scenario).phase}`);
  setRef(repo, `refs/heads/${branch}`, commitAfter(repo, phaseHead, `feat: ${branch}`));
});

Given(/^no proof exists for "[^"]+"$/, () => {
  // Nothing is recorded: the ledger and the verdicts hold no proof of this feature.
});

Given(/^only a passed "(.+)" exists at the head$/, ({ scenario }, command: string) => {
  seedTest(requireRepo(worldOf(scenario)), featureBranch, command, true);
});

Given(/^only a PASS exists at the head$/, ({ scenario }) => {
  review(scenario, featureOf(featureBranch), 'VERDICT: PASS');
});

Given(/^both proofs exist at an older commit of the branch$/, ({ scenario }) => {
  const repo = requireRepo(worldOf(scenario));
  seedTest(repo, featureBranch, 'pnpm test:harness', true);
  review(scenario, featureOf(featureBranch), 'VERDICT: PASS');
  commitOnBranch(repo, featureBranch, 'feat: a commit after the proofs');
});

Given(
  /^a passed "(.+?)" and a PASS exist at the head(?: of "([^"]+)")?$/,
  ({ scenario }, command: string, branch: string | undefined) => {
    const repo = requireRepo(worldOf(scenario));
    const target = branch ?? featureBranch;
    seedTest(repo, target, command, true);
    review(scenario, featureOf(target), 'VERDICT: PASS');
  },
);

Given(/^a passed "(.+?)" on a dirty tree and a PASS exist at the head$/, ({ scenario }, command: string) => {
  seedTest(requireRepo(worldOf(scenario)), featureBranch, command, false);
  review(scenario, featureOf(featureBranch), 'VERDICT: PASS');
});

Given(/^a passed "(.+?)", a PASS and then a FAIL exist at the head$/, ({ scenario }, command: string) => {
  const feature = featureOf(featureBranch);
  seedTest(requireRepo(worldOf(scenario)), featureBranch, command, true);
  review(scenario, feature, 'VERDICT: PASS');
  review(scenario, feature, 'VERDICT: FAIL');
});

Given(
  /^a passed "(.+?)" exists at the head of "([^"]+)"$/,
  ({ scenario }, command: string, branch: string) => {
    seedTest(requireRepo(worldOf(scenario)), branch, command, true);
  },
);

Given(/^"([^"]+)" is at the head$/, ({ scenario }, ref: string) => {
  const repo = requireRepo(worldOf(scenario));
  setRef(repo, `refs/remotes/${ref}`, headOf(repo));
});

Given(/^"([^"]+)" points to a newer commit$/, ({ scenario }, ref: string) => {
  const repo = requireRepo(worldOf(scenario));
  setRef(
    repo,
    `refs/remotes/${ref}`,
    commitAfter(repo, headOf(repo), 'feat: a commit the branch does not hold'),
  );
});

Given(/^a branch "([^"]+)" holds that head and one more commit$/, ({ scenario }, branch: string) => {
  const repo = requireRepo(worldOf(scenario));
  setRef(repo, `refs/heads/${branch}`, commitAfter(repo, headOf(repo), 'feat: one more commit'));
});

Given(
  /^a branch "([^"]+)" was pushed from that head and deleted locally$/,
  ({ scenario }, branch: string) => {
    const repo = requireRepo(worldOf(scenario));
    setRef(repo, `refs/remotes/origin/${branch}`, headOf(repo));
  },
);

Given(/^nothing else changed$/, () => {
  // The branches stay as the scenario set them.
});

// The worktree edits and the main checkout edits of the harness-self scope (HBS-18 to HBS-23).
When(
  /^the agent edits "([^"]+)" in the worktree of "([^"]+)"$/,
  ({ scenario }, rel: string, worktree: string) => {
    const world = worldOf(scenario);
    const repo = requireRepo(world);
    mkdirSync(worktreeDir(repo, worktree), { recursive: true });
    world.answer = askGate(scenario, editCall(`${repo}/.claude/worktrees/${worktree}/${rel}`));
  },
);

When(/^the agent edits "([^"]+)" in the main checkout$/, ({ scenario }, rel: string) => {
  const world = worldOf(scenario);
  world.answer = askGate(scenario, editCall(`${requireRepo(world)}/${rel}`));
});

When(/^the agent edits the file "([^"]+)"$/, ({ scenario }, rel: string) => {
  const world = worldOf(scenario);
  world.answer = askGate(scenario, editCall(`${requireRepo(world)}/${rel}`));
});

When(
  /^the agent removes a test case from "([^"]+)" in the worktree of "([^"]+)"$/,
  ({ scenario }, rel: string, worktree: string) => {
    const world = worldOf(scenario);
    const repo = requireRepo(world);
    writeFile(path.join(worktreeDir(repo, worktree), rel), testFileText);
    world.answer = askGate(scenario, removeCaseCall(`${repo}/.claude/worktrees/${worktree}/${rel}`));
  },
);

When(
  /^the agent dispatches a "([^"]+)" for "([^"]+)" with step "([^"]+)" in the background$/,
  ({ scenario }, agent: string, feature: string, step: string) => {
    const world = worldOf(scenario);
    world.answer = askGate(scenario, {
      tool_name: 'Task',
      tool_use_id: 'toolu_hbs_background',
      tool_input: {
        subagent_type: agent,
        description: 'review the diff',
        prompt: `${header(feature, step)} review the diff`,
        run_in_background: true,
      },
    });
  },
);

When(
  /^a foreground "([^"]+)" dispatch for "([^"]+)" with step "([^"]+)" returns a report ending "(.+)"$/,
  ({ scenario }, agent: string, feature: string, step: string, ending: string) => {
    const dispatch = startDispatch(scenario, agent, `${header(feature, step)} review the diff`);
    finishDispatch(scenario, dispatch, reportEnding(ending));
  },
);

When(
  /^a foreground "([^"]+)" dispatch for "([^"]+)" with step "([^"]+)" starts and never returns$/,
  ({ scenario }, agent: string, feature: string, step: string) => {
    startDispatch(scenario, agent, `${header(feature, step)} review the diff`);
  },
);

When(
  /^a foreground "([^"]+)" dispatch for "([^"]+)" with step "([^"]+)" starts$/,
  ({ scenario }, agent: string, feature: string, step: string) => {
    startDispatch(scenario, agent, `${header(feature, step)} review the diff`);
  },
);

When(
  /^a foreground "([^"]+)" dispatch with the prompt "(.+)" returns a report ending "(.+)"$/,
  ({ scenario }, agent: string, prompt: string, ending: string) => {
    const dispatch = startDispatch(scenario, agent, prompt);
    finishDispatch(scenario, dispatch, reportEnding(ending));
  },
);

When(/^the dispatch returns a report ending "(.+)"$/, ({ scenario }, ending: string) => {
  finishDispatch(scenario, requireDispatch(worldOf(scenario)), reportEnding(ending));
});

When(/^a commit lands on "([^"]+)"$/, ({ scenario }, branch: string) => {
  commitOnBranch(requireRepo(worldOf(scenario)), branch, 'feat: a commit made while the review ran');
});

// The merge by commit id of a covered branch (HBS-32): the head commit is named, not the branch.
When(
  /^the agent merges the head commit id of "([^"]+)" with "([^"]+)"$/,
  ({ scenario }, branch: string, command: string) => {
    const world = worldOf(scenario);
    world.answer = askGate(scenario, bashCall(`${command} ${headOf(requireRepo(world), branch)}`));
  },
);

When(/^the agent asks the gate to run "(.+)"$/, ({ scenario }, command: string) => {
  const world = worldOf(scenario);
  const repo = requireRepo(world);
  const expanded = command.includes('{head}') ? command.replaceAll('{head}', headOf(repo)) : command;
  world.answer = askGate(scenario, bashCall(expanded));
});

Then(/^the gate answers "(allow|ask|deny)"$/, ({ scenario }, decision: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.decision, `gate decision (reason: ${answer.reason})`).toBe(decision);
});

Then(/^the gate does not answer "(allow|ask|deny)"$/, ({ scenario }, decision: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.decision, `gate decision (reason: ${answer.reason})`).not.toBe(decision);
});

Then(/^the gate gives no decision$/, ({ scenario }) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.decision, `gate decision (reason: ${answer.reason})`).toBeUndefined();
});

Then(/^the reason names "(.+)"$/, ({ scenario }, text: string) => {
  const answer = requireAnswer(worldOf(scenario));
  expect(answer.reason, 'the gate reason').toContain(text);
});

Then(
  /^the verdicts hold a (PASS|FAIL) for "([^"]+)" at the head of "([^"]+)"$/,
  ({ scenario }, verdict: string, feature: string, branch: string) => {
    const repo = requireRepo(worldOf(scenario));
    expectLatestVerdict(repo, feature, headOf(repo, branch), verdict);
  },
);

Then(
  /^the verdicts hold a (PASS|FAIL) for "([^"]+)" at the head the dispatch started on$/,
  ({ scenario }, verdict: string, feature: string) => {
    const world = worldOf(scenario);
    if (world.dispatchHead === undefined) throw new Error('no dispatch has started in this scenario');
    expectLatestVerdict(requireRepo(world), feature, world.dispatchHead, verdict);
  },
);

Then(/^the verdicts hold nothing for "([^"]+)"$/, ({ scenario }, feature: string) => {
  expect(verdictsOf(requireRepo(worldOf(scenario)), feature), `verdicts of ${feature}`).toEqual([]);
});

// The guides HBS-37 to HBS-42 read: the agent guide, the phase runner skill and its escalation reference, the Claude
// guide. Each When step reads its files into the scenario; each Then step checks what the criterion names.
const phaseRunnerSkill = '.claude/skills/d2rmm-phase-runner/SKILL.md';
const escalationReference = '.claude/skills/d2rmm-phase-runner/references/escalation.md';
const verdictHookFile = 'verdict.mjs';

function guideText(scenario: Scenario, rel: string): string {
  return readFileSync(path.join(scenario.repoRoot, rel), 'utf8');
}

function guideOf(scenario: Scenario, rel: string): string {
  const text = worldOf(scenario).guides.get(rel);
  if (text === undefined) throw new Error(`${rel} has not been read in this scenario`);
  return text;
}

// Rule n of AGENTS.md's "Inviolable rules": from its line to the line of rule n + 1.
function ruleOf(agents: string, n: number): string {
  const start = agents.indexOf(`\n${n}. `, agents.indexOf('## Inviolable rules'));
  if (start < 0) throw new Error(`rule ${n} is not in AGENTS.md`);
  const end = agents.indexOf(`\n${n + 1}. `, start + 1);
  return agents.slice(start, end < 0 ? undefined : end);
}

// The escalation item of AGENTS.md's "Phase workflow": from its line to the line of item 6.
function escalationItemOf(agents: string): string {
  const start = agents.indexOf('\n5. **Escalations', agents.indexOf('## Phase workflow'));
  if (start < 0) throw new Error('the escalation item is not in AGENTS.md');
  const end = agents.indexOf('\n6. ', start + 1);
  return agents.slice(start, end < 0 ? undefined : end);
}

// A level-2 section of a document: from its heading to the next level-2 heading.
function sectionOf(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`${heading} is not in the document`);
  const end = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, end < 0 ? undefined : end);
}

// The first cell of each row of a markdown table, without the separator row.
function firstCellsOf(table: string): string[] {
  return table
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|')[1]?.trim() ?? '')
    .filter((cell) => cell !== '' && !/^-+$/.test(cell));
}

// Every quoted phrase of a step, in order.
function phrasesOf(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

When(/^the agent reads the agent guide$/, ({ scenario }) => {
  worldOf(scenario).guides.set('AGENTS.md', guideText(scenario, 'AGENTS.md'));
});

When(
  /^the agent reads the phase runner instructions, the escalation list and the Claude guide$/,
  ({ scenario }) => {
    const world = worldOf(scenario);
    for (const rel of [phaseRunnerSkill, escalationReference, 'CLAUDE.md']) {
      world.guides.set(rel, guideText(scenario, rel));
    }
  },
);

Then(/^rule (\d+) contains (.+)$/, ({ scenario }, number: string, list: string) => {
  const rule = ruleOf(guideOf(scenario, 'AGENTS.md'), Number(number));
  for (const phrase of phrasesOf(list)) {
    expect(rule, `rule ${number} of AGENTS.md`).toContain(phrase);
  }
});

Then(/^the phase workflow's escalation item contains none of (.+)$/, ({ scenario }, list: string) => {
  const item = escalationItemOf(guideOf(scenario, 'AGENTS.md'));
  for (const phrase of phrasesOf(list)) {
    expect(item, 'the escalation item of the phase workflow').not.toContain(phrase);
  }
});

Then(
  /^the phase runner instructions do not contain "([^"]+)" in any letter case$/,
  ({ scenario }, phrase: string) => {
    const text = guideOf(scenario, phaseRunnerSkill).toLowerCase();
    expect(text, 'the phase runner instructions').not.toContain(phrase.toLowerCase());
  },
);

Then(
  /^the phase runner's escalation summary contains neither "([^"]+)" nor "([^"]+)"$/,
  ({ scenario }, first: string, second: string) => {
    const summary = sectionOf(guideOf(scenario, phaseRunnerSkill), '## Escalations');
    expect(summary, 'the escalation summary of the phase runner').not.toContain(first);
    expect(summary, 'the escalation summary of the phase runner').not.toContain(second);
  },
);

Then(/^no first cell of the escalation table contains (.+)$/, ({ scenario }, list: string) => {
  const cells = firstCellsOf(guideOf(scenario, escalationReference));
  for (const phrase of phrasesOf(list)) {
    expect(
      cells.filter((cell) => cell.includes(phrase)),
      `first cells of the escalation table containing "${phrase}"`,
    ).toEqual([]);
  }
});

Then(/^first cells of the escalation table contain (.+)$/, ({ scenario }, list: string) => {
  const cells = firstCellsOf(guideOf(scenario, escalationReference));
  for (const phrase of phrasesOf(list)) {
    expect(
      cells.some((cell) => cell.includes(phrase)),
      `a first cell of the escalation table containing "${phrase}"`,
    ).toBe(true);
  }
});

Then(
  /^the Claude guide contains "([^"]+)" and the file name of the hook that records the "security-reviewer" verdict$/,
  ({ scenario }, phrase: string) => {
    const guide = guideOf(scenario, 'CLAUDE.md');
    expect(guide, 'the Claude guide').toContain(phrase);
    expect(
      existsSync(path.join(scenario.repoRoot, '.claude', 'hooks', verdictHookFile)),
      'the verdict hook',
    ).toBe(true);
    expect(guide, 'the Claude guide').toContain(verdictHookFile);
  },
);

After(({ scenario }) => {
  const stored = scenario.values.get(KEY) as BootstrapWorld | undefined;
  for (const dir of stored?.temporary ?? []) rmSync(dir, { recursive: true, force: true });
});
