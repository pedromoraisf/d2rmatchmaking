// Acceptance steps for budget-v2 (ADR 023, ADR 028 § 4), one step per line of acceptance.feature. Black box: the wrapper
// (scripts/attempt.mjs), the gate hook and the Stop hook of this checkout run as child processes against a temporary git
// repository, or against a temporary directory that is not one. Nothing here imports scripts/lib or .claude/hooks/lib.
// The gate steps that harness-bootstrap defines ("the agent asks the gate to run …", "the gate answers …", "the reason
// names …") are reused, never defined again; the state they read lives in support/gate-world.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Given, Then, When, type Scenario } from '../fixtures.ts';
import { answerOf, gateWorldOf, requireGateRepo, type GateAnswer } from '../support/gate-world.ts';

const KEY = 'budget-v2';
const sessionId = 'budget-v2-acceptance';
const emitter = 'emit.mjs';
const maxOutputBytes = 16 * 1024 * 1024;
const wrapperTimeoutMs = 180_000;
const hookTimeoutMs = 120_000;
// The wrapper's one-minute timeout (BUD-06) waits longer than the suite's 60 s test timeout: this scenario raises its own.
const oneMinuteTestTimeoutMs = 150_000;
const retryBudgetReference = '.claude/skills/d2rmm-phase-runner/references/retry-budget.md';
const attemptLine = /attempt \d+\/\d+ for /;
const diagnosisLabels = [
  'free memory',
  'swap used',
  'load average',
  'running containers',
  'leftover acceptance processes',
];
const countedOutput = 'expected 2, received 3';
const dockerOutput = 'Cannot connect to the Docker daemon';

// A gate unit as the wrapper names it: gate:<feature>/<step>.
interface Target {
  feature: string;
  step: string;
}

// A gate the scenario runs: its unit and the command the wrapper runs.
interface Gate extends Target {
  command: string;
}

// One run of the wrapper: its exit status (null when a signal ended it) and what it printed.
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

// What the Stop hook printed: a decision to block, and a message.
interface StopAnswer {
  decision?: string;
  systemMessage?: string;
}

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface BudgetWorld {
  gate: Gate | undefined;
  lastRun: Run | undefined;
  repeated: Run[];
  sequence: number;
  resetReason: string | undefined;
  stop: StopAnswer | undefined;
  guides: Map<string, string>;
}

// One row of `attempt.mjs status`: the unit, its status and its counted failures.
interface StatusRow {
  status: string;
  key: string;
  failures: number;
}

// The tables of `attempt.mjs report`: the unit rows (in the header's order) and the reset rows.
interface Report {
  header: string[];
  units: string[][];
  resets: string[][];
}

const defaultTarget: Target = { feature: 'demo', step: 'T1' };

function worldOf(scenario: Scenario): BudgetWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as BudgetWorld;
  const created: BudgetWorld = {
    gate: undefined,
    lastRun: undefined,
    repeated: [],
    sequence: 0,
    resetReason: undefined,
    stop: undefined,
    guides: new Map<string, string>(),
  };
  scenario.values.set(KEY, created);
  return created;
}

function repoOf(scenario: Scenario): string {
  return requireGateRepo(gateWorldOf(scenario));
}

// The environment without the variables a git hook or a hook runner exports: children act on their own repository.
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(GIT_|D2RMM_|CLAUDE_)/.test(key)),
  );
}

const identity = [
  '-c',
  'user.name=d2rmm acceptance',
  '-c',
  'user.email=acceptance@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
    maxBuffer: maxOutputBytes,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
}

function gitCommit(cwd: string, message: string, extra: string[] = []): void {
  git(cwd, [...identity, 'commit', '-q', ...extra, '-m', message]);
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

// Registers a directory the scenario creates (removed by the After hook of harness-bootstrap) and makes it the repository.
function adopt(scenario: Scenario, dir: string): string {
  const gate = gateWorldOf(scenario);
  gate.temporary.push(dir);
  gate.repo = dir;
  return dir;
}

// The emitter stands in for a gate command: it prints fixed output and exits with a fixed status, numbers its lines,
// hangs, or kills itself. It is a fixture of the scenarios, not product code.
const emitterText = String.raw`// Stand-in for a gate in the budget-v2 acceptance scenarios: fixed output, a fixed exit status, a hang or a SIGKILL.
const [mode, first, second] = process.argv.slice(2);
if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'kill') {
  process.kill(process.pid, 'SIGKILL');
} else if (mode === 'numbered') {
  for (let i = 1; i <= Number(first); i += 1) process.stdout.write('line ' + i + '\n');
  process.exit(0);
} else {
  // text <base64 of the output> <exit status>
  process.stdout.write(Buffer.from(first, 'base64').toString('utf8') + '\n');
  process.exit(Number(second));
}
`;

// The specs and acceptance checks the Stop hook runs when a file under .specs/ changed: each prints what the scenario
// left in .specs/stop-output/ and fails; without that file it passes.
function checkScriptOf(name: string): string {
  return [
    `// Stands in for the ${name} of the budget-v2 acceptance scenarios: it prints what a scenario left in`,
    `// .specs/stop-output/${name}.txt and fails; without that file it passes.`,
    "import { existsSync, readFileSync } from 'node:fs';",
    `const file = '.specs/stop-output/${name}.txt';`,
    'if (existsSync(file)) {',
    "  process.stdout.write(readFileSync(file, 'utf8'));",
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

function briefText(feature: string): string {
  return [
    '# Phase F0 brief',
    '',
    '**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos" (delegated via .specs/phases/F0/brief.md)',
    '',
    '## Features',
    '',
    '| Feature | Size |',
    '| --- | --- |',
    `| ${feature} | Medium |`,
    '',
    '## Delegation',
    '',
    '- [ ] harness-self',
    '- [ ] local-merge-phase-branch',
    '',
  ].join('\n');
}

// What every repository and every directory of the scenarios holds: the emitter, the feature's tasks and a file to edit.
function populate(dir: string, feature: string): void {
  write(path.join(dir, emitter), emitterText);
  write(
    path.join(dir, '.specs', 'features', feature, 'tasks.md'),
    `# ${feature} tasks\n\n### T1: A gate the budget counts\n\n### T2: A second gate of the same feature\n`,
  );
  write(path.join(dir, 'notes.txt'), 'first version\n');
}

// The approved phase, the feature on its branch, and the Stop hook's two checks, committed: a git repository the
// scenario's gate calls run in.
function createRepository(dir: string, feature: string): void {
  populate(dir, feature);
  write(path.join(dir, '.specs', 'phases', 'F0', 'brief.md'), briefText(feature));
  write(path.join(dir, '.specs', 'phases', 'ACTIVE'), 'F0\n');
  write(path.join(dir, 'scripts', 'specs-check.mjs'), checkScriptOf('specs-check'));
  write(path.join(dir, 'scripts', 'acceptance-check.mjs'), checkScriptOf('acceptance-check'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  gitCommit(dir, 'chore: demo repository');
  git(dir, ['branch', 'phase/F0']);
  git(dir, ['checkout', '-q', '-b', `feat/F0-${feature}`]);
}

// The wrapper of this checkout, run in `cwd` with `args`. It does not change the scenario's last run.
function invoke(scenario: Scenario, args: string[]): Run {
  const script = path.join(scenario.repoRoot, 'scripts', 'attempt.mjs');
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoOf(scenario),
    encoding: 'utf8',
    env: cleanEnv(),
    maxBuffer: maxOutputBytes,
    timeout: wrapperTimeoutMs,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// A wrapper run that the scenario's steps read afterwards.
function wrapper(scenario: Scenario, args: string[]): Run {
  const run = invoke(scenario, args);
  worldOf(scenario).lastRun = run;
  return run;
}

function requireRun(scenario: Scenario): Run {
  const run = worldOf(scenario).lastRun;
  if (run === undefined) throw new Error('the wrapper has not run in this scenario');
  return run;
}

function requireGate(scenario: Scenario): Gate {
  const gate = worldOf(scenario).gate;
  if (gate === undefined) throw new Error('no gate has run in this scenario');
  return gate;
}

// The gate the scenario is about, or the default unit (every step of this feature names demo and T1 unless it says so).
function currentTarget(scenario: Scenario): Target {
  return worldOf(scenario).gate ?? defaultTarget;
}

function keyOf(target: Target): string {
  return `gate:${target.feature}/${target.step}`;
}

function targetOf(key: string): Target {
  const match = /^gate:([^/]+)\/(.+)$/.exec(key);
  if (!match) throw new Error(`${key} is not a gate unit`);
  return { feature: match[1] ?? '', step: match[2] ?? '' };
}

// The gate command that prints `text` (\n is a line break) and exits with `status`.
function outputCommand(text: string, status: number): string {
  const encoded = Buffer.from(text.replaceAll('\\n', '\n'), 'utf8').toString('base64');
  return `node ${emitter} text ${encoded} ${status}`;
}

// One run of a gate through the wrapper. `remember` keeps it as the gate "the same gate again" reruns.
function runOn(
  scenario: Scenario,
  target: Target,
  command: string,
  options: { timeout?: string; remember?: boolean } = {},
): Run {
  const args = ['run', '--feature', target.feature, '--step', target.step];
  if (options.timeout !== undefined) args.push('--timeout', options.timeout);
  args.push('--', command);
  const run = wrapper(scenario, args);
  if (options.remember !== false) worldOf(scenario).gate = { ...target, command };
  return run;
}

function nextNumber(scenario: Scenario): number {
  const world = worldOf(scenario);
  world.sequence += 1;
  return world.sequence;
}

// Counted failures of one unit. Each command differs, so none is refused as an unchanged rerun (BUD-09).
function countedFailures(scenario: Scenario, target: Target, times: number): void {
  for (let i = 0; i < times; i += 1) {
    runOn(scenario, target, outputCommand(`${countedOutput} (run ${nextNumber(scenario)})`, 1), {
      remember: false,
    });
  }
}

// Machine failures in a row of one unit: the Docker daemon is unreachable (BUD-02).
function machineFailures(scenario: Scenario, target: Target, times: number): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < times; i += 1) {
    runs.push(runOn(scenario, target, outputCommand(dockerOutput, 1), { remember: false }));
  }
  return runs;
}

function statusRows(scenario: Scenario): StatusRow[] {
  return invoke(scenario, ['status'])
    .stdout.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((tokens) => tokens.length >= 3)
    .map((tokens) => {
      const failures = /\((\d+)\//.exec(tokens[2] ?? '')?.[1];
      return {
        status: tokens[0] ?? '',
        key: tokens[1] ?? '',
        failures: failures === undefined ? 0 : Number(failures),
      };
    });
}

function rowOf(scenario: Scenario, key: string): StatusRow | undefined {
  return statusRows(scenario).find((row) => row.key === key);
}

function reportOf(scenario: Scenario): Report {
  const report: Report = { header: [], units: [], resets: [] };
  let mode: 'none' | 'units' | 'resets' = 'none';
  for (const line of invoke(scenario, ['report']).stdout.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/`/g, ''));
    if (cells[0] === 'Unit') {
      mode = 'units';
      report.header = cells;
    } else if (cells[0] === 'Reset unit') {
      mode = 'resets';
    } else if (cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    } else if (mode === 'units') {
      report.units.push(cells);
    } else if (mode === 'resets') {
      report.resets.push(cells);
    }
  }
  return report;
}

function unitRowOf(report: Report, key: string): string[] | undefined {
  return report.units.find((cells) => cells[0] === key);
}

// A reset by the orchestrator, which must succeed (the Given steps use it for the first reset of a unit).
function orchestratorReset(scenario: Scenario, key: string, reason: string): void {
  const run = wrapper(scenario, ['reset', '--unit', key, '--by', 'orchestrator', '--reason', reason]);
  expect(run.status, 'the first orchestrator reset').toBe(0);
  worldOf(scenario).resetReason = reason;
}

// The maintainer's reset of a unit: no reason is needed, the gate asks for it (ADR 022).
function maintainerReset(scenario: Scenario, key: string): void {
  const run = wrapper(scenario, ['reset', '--unit', key, '--by', 'pedromoraisf']);
  expect(run.status, 'the maintainer reset').toBe(0);
}

function durationOf(run: Run): number {
  const seconds = / in (\d+(?:\.\d+)?)s\./.exec(run.stderr)?.[1];
  if (seconds === undefined) throw new Error(`the wrapper printed no duration:\n${run.stderr}`);
  return Number(seconds);
}

// Writes the Stop hook's checks' output, so each of the two checks fails with the text the scenario gives.
function writeStopOutput(scenario: Scenario, specs: string, acceptance: string): void {
  const dir = path.join(repoOf(scenario), '.specs', 'stop-output');
  write(path.join(dir, 'specs-check.txt'), `${specs}\n`);
  write(path.join(dir, 'acceptance-check.txt'), `${acceptance}\n`);
}

// The Stop hook of this checkout, run in the scenario's repository, after the agent ends its turn.
function stopHookOf(scenario: Scenario): StopAnswer {
  const repo = repoOf(scenario);
  const script = path.join(scenario.repoRoot, '.claude', 'hooks', 'stop.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    input: JSON.stringify({
      session_id: sessionId,
      cwd: repo,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }),
    encoding: 'utf8',
    env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo },
    maxBuffer: maxOutputBytes,
    timeout: hookTimeoutMs,
  });
  if (result.status !== 0) throw new Error(`stop.mjs exited ${result.status}\n${result.stderr}`);
  const text = result.stdout.trim();
  return text === '' ? {} : (JSON.parse(text) as StopAnswer);
}

// The gate hook of this checkout, for one tool call made in `cwd`. Its answer is the gate world's answer.
function askFrom(scenario: Scenario, cwd: string, payload: Record<string, unknown>): GateAnswer {
  const repo = repoOf(scenario);
  const script = path.join(scenario.repoRoot, '.claude', 'hooks', 'gate.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: sessionId, cwd, ...payload }),
    encoding: 'utf8',
    env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo },
    maxBuffer: maxOutputBytes,
    timeout: hookTimeoutMs,
  });
  if (result.status !== 0) throw new Error(`gate.mjs exited ${result.status}\n${result.stderr}`);
  const answer = answerOf(result.stdout.trim());
  gateWorldOf(scenario).answer = answer;
  return answer;
}

function bashCall(command: string): Record<string, unknown> {
  return { tool_name: 'Bash', tool_input: { command } };
}

function requireAnswer(scenario: Scenario): GateAnswer {
  const answer = gateWorldOf(scenario).answer;
  if (answer === undefined) throw new Error('the gate has not been asked in this scenario');
  return answer;
}

function stopFailures(scenario: Scenario): number {
  return statusRows(scenario)
    .filter((row) => row.key.startsWith('stop:'))
    .reduce((sum, row) => sum + row.failures, 0);
}

// Rule 11 of AGENTS.md's "Inviolable rules", from its line to the line of rule 12, with whitespace folded.
function ruleElevenOf(agents: string): string {
  const rules = agents.slice(agents.indexOf('## Inviolable rules'));
  const start = rules.indexOf('\n11. ');
  const end = rules.indexOf('\n12. ');
  if (start < 0 || end < 0) throw new Error('rule 11 of AGENTS.md is not between rules 11 and 12');
  return rules.slice(start + 1, end).replace(/\s+/g, ' ');
}

function guideOf(scenario: Scenario, rel: string): string {
  const text = worldOf(scenario).guides.get(rel);
  if (text === undefined) throw new Error(`${rel} has not been read in this scenario`);
  return text;
}

// ---- Given ----

Given(
  /^a temporary repository with an approved phase brief and the feature "([^"]+)"$/,
  ({ scenario }, feature: string) => {
    createRepository(adopt(scenario, mkdtempSync(path.join(os.tmpdir(), 'd2rmm-budget-'))), feature);
  },
);

Given(
  /^a directory that is not a git repository with the feature "([^"]+)"$/,
  ({ scenario }, feature: string) => {
    populate(adopt(scenario, mkdtempSync(path.join(os.tmpdir(), 'd2rmm-budget-'))), feature);
  },
);

Given(/^the unit "([^"]+)" is blocked$/, ({ scenario }, key: string) => {
  countedFailures(scenario, targetOf(key), 3);
});

Given(/^the unit "([^"]+)" is env-blocked$/, ({ scenario }, key: string) => {
  machineFailures(scenario, targetOf(key), 3);
});

Given(/^the unit "([^"]+)" is blocked after an orchestrator reset$/, ({ scenario }, key: string) => {
  countedFailures(scenario, targetOf(key), 3);
  orchestratorReset(scenario, key, 'fixed');
  countedFailures(scenario, targetOf(key), 3);
});

Given(
  /^the unit "([^"]+)" is blocked after an orchestrator reset and a maintainer one$/,
  ({ scenario }, key: string) => {
    countedFailures(scenario, targetOf(key), 3);
    orchestratorReset(scenario, key, 'fixed');
    countedFailures(scenario, targetOf(key), 3);
    maintainerReset(scenario, key);
    countedFailures(scenario, targetOf(key), 3);
  },
);

// The report's columns (BUD-16): the unit has a machine failure and a refused rerun, then the orchestrator resets it. A
// second unit of the feature keeps a machine failure and a refused rerun in the table after that reset.
Given(
  /^the unit "([^"]+)" had a machine failure, a refused rerun and an orchestrator reset$/,
  ({ scenario }, key: string) => {
    const target = targetOf(key);
    const counted = outputCommand(`${countedOutput} (run ${nextNumber(scenario)})`, 1);
    runOn(scenario, target, counted, { remember: false });
    expect(runOn(scenario, target, counted, { remember: false }).status, 'the refused rerun').toBe(4);
    machineFailures(scenario, target, 1);
    orchestratorReset(scenario, key, 'fixed');

    const other: Target = { feature: target.feature, step: 'T2' };
    const otherCounted = outputCommand(`${countedOutput} (run ${nextNumber(scenario)})`, 1);
    runOn(scenario, other, otherCounted, { remember: false });
    expect(runOn(scenario, other, otherCounted, { remember: false }).status, 'the refused rerun of T2').toBe(
      4,
    );
    machineFailures(scenario, other, 1);
  },
);

Given(
  /^the agent ran a gate (?:there )?for "([^"]+)" step "([^"]+)" that failed with "(.+)"$/,
  ({ scenario }, feature: string, step: string, text: string) => {
    const run = runOn(scenario, { feature, step }, outputCommand(text, 1));
    expect(run.status, 'the failing gate exits 1').toBe(1);
  },
);

Given(/^another command of the same unit then failed with "(.+)"$/, ({ scenario }, text: string) => {
  runOn(scenario, currentTarget(scenario), outputCommand(text, 1), { remember: false });
});

Given(/^the agent made an empty commit$/, ({ scenario }) => {
  gitCommit(repoOf(scenario), 'chore: an empty commit', ['--allow-empty']);
});

Given(/^the Stop hook's checks fail with "(.+)"$/, ({ scenario }, text: string) => {
  writeStopOutput(scenario, text, text);
});

Given(
  /^the Stop hook's checks fail, one with "(.+)" and one with "(.+)"$/,
  ({ scenario }, first: string, second: string) => {
    writeStopOutput(scenario, first, second);
  },
);

// ---- When ----

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" that prints "([\s\S]*)" and exits (\d+)$/,
  ({ scenario }, feature: string, step: string, text: string, status: string) => {
    runOn(scenario, { feature, step }, outputCommand(text, Number(status)));
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" that kills itself with SIGKILL$/,
  ({ scenario }, feature: string, step: string) => {
    runOn(scenario, { feature, step }, `node ${emitter} kill`);
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" that fails with "(.+)" (once|twice|three times)$/,
  ({ scenario }, feature: string, step: string, text: string, times: string) => {
    const counts: Record<string, number> = { once: 1, twice: 2, 'three times': 3 };
    const count = counts[times] ?? 1;
    const target = { feature, step };
    const runs: Run[] = [];
    for (let i = 0; i < count; i += 1) runs.push(runOn(scenario, target, outputCommand(text, 1)));
    worldOf(scenario).repeated = runs;
  },
);

When(
  /^the agent changes a file and runs a gate for "([^"]+)" step "([^"]+)" that prints "([\s\S]*)" and exits (\d+)$/,
  ({ scenario }, feature: string, step: string, text: string, status: string) => {
    write(path.join(repoOf(scenario), `changed-${nextNumber(scenario)}.txt`), 'a change the gate can see\n');
    runOn(scenario, { feature, step }, outputCommand(text, Number(status)));
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" with "(--timeout [^"]*)" that never ends$/,
  ({ scenario, $testInfo }, feature: string, step: string, option: string) => {
    $testInfo.setTimeout(oneMinuteTestTimeoutMs);
    runOn(scenario, { feature, step }, `node ${emitter} hang`, {
      timeout: option.replace('--timeout', '').trim(),
    });
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" with "(--timeout [^"]*)"$/,
  ({ scenario }, feature: string, step: string, option: string) => {
    runOn(scenario, { feature, step }, outputCommand('ran', 0), {
      timeout: option.replace('--timeout', '').trim(),
    });
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" with another command and no file changed$/,
  ({ scenario }, feature: string, step: string) => {
    runOn(scenario, { feature, step }, outputCommand('another command', 1), { remember: false });
  },
);

When(
  /^the agent runs a gate for "([^"]+)" step "([^"]+)" that prints (\d+) numbered lines and exits 0$/,
  ({ scenario }, feature: string, step: string, lines: string) => {
    runOn(scenario, { feature, step }, `node ${emitter} numbered ${lines}`);
  },
);

When(/^the agent runs the same gate again(?: without changing any file)?$/, ({ scenario }) => {
  const gate = requireGate(scenario);
  runOn(scenario, gate, gate.command, { remember: false });
});

When(
  /^the agent (edits a tracked file|adds an untracked file) and runs the same gate again$/,
  ({ scenario }, change: string) => {
    const repo = repoOf(scenario);
    const n = nextNumber(scenario);
    if (change === 'edits a tracked file') write(path.join(repo, 'notes.txt'), `edit ${n}\n`);
    else write(path.join(repo, `added-${n}.txt`), `added ${n}\n`);
    const gate = requireGate(scenario);
    runOn(scenario, gate, gate.command, { remember: false });
  },
);

When(/^the agent ends its turn$/, ({ scenario }) => {
  worldOf(scenario).stop = stopHookOf(scenario);
});

When(
  /^the orchestrator resets "([^"]+)" with the reason "(.+)"$/,
  ({ scenario }, key: string, reason: string) => {
    const run = wrapper(scenario, ['reset', '--unit', key, '--by', 'orchestrator', '--reason', reason]);
    if (run.status === 0) worldOf(scenario).resetReason = reason;
  },
);

When(/^the orchestrator resets "([^"]+)" with no reason$/, ({ scenario }, key: string) => {
  wrapper(scenario, ['reset', '--unit', key, '--by', 'orchestrator']);
});

When(/^the unit "([^"]+)" is blocked again$/, ({ scenario }, key: string) => {
  countedFailures(scenario, targetOf(key), 3);
});

When(/^the agent runs "node scripts\/attempt\.mjs (.+)"$/, ({ scenario }, args: string) => {
  wrapper(scenario, args.split(/\s+/));
});

When(
  /^the agent asks the gate to run the wrapper for "([^"]+)" step "([^"]+)" followed by "(.+)"$/,
  ({ scenario }, feature: string, step: string, tail: string) => {
    askFrom(
      scenario,
      repoOf(scenario),
      bashCall(`node scripts/attempt.mjs run --feature ${feature} --step ${step} -- "pnpm test" ${tail}`),
    );
  },
);

// BUD-20: the call is made from a feature's worktree, so the gate reads the feature from the worktree's path.
When(
  /^the agent, working in the worktree of "([^"]+)", asks the gate to run "(.+)"$/,
  ({ scenario }, worktree: string, command: string) => {
    const dir = path.join(repoOf(scenario), '.claude', 'worktrees', worktree);
    mkdirSync(dir, { recursive: true });
    askFrom(scenario, dir, bashCall(command));
  },
);

When(/^the agent reads the agent guide and the retry-budget reference$/, ({ scenario }) => {
  const world = worldOf(scenario);
  for (const rel of ['AGENTS.md', retryBudgetReference]) {
    world.guides.set(rel, readFileSync(path.join(scenario.repoRoot, rel), 'utf8'));
  }
});

// ---- Then ----

Then(/^the gate's failure count (?:stays|is) (\d+)$/, ({ scenario }, count: string) => {
  const key = keyOf(currentTarget(scenario));
  expect(rowOf(scenario, key)?.failures ?? 0, `counted failures of ${key}`).toBe(Number(count));
});

Then(/^the wrapper says the failure was not counted and names "(.+)"$/, ({ scenario }, signature: string) => {
  const run = requireRun(scenario);
  expect(run.stderr, 'the wrapper output').toContain('not counted');
  expect(run.stderr, 'the wrapper output').toContain(`signature "${signature}"`);
});

Then(/^the unit is "([^"]+)"$/, ({ scenario }, status: string) => {
  const key = keyOf(currentTarget(scenario));
  expect(rowOf(scenario, key)?.status, `the status of ${key}`).toBe(status);
});

Then(
  /^the third run printed the free memory, the swap used, the load average, the running containers and the leftover acceptance processes$/,
  ({ scenario }) => {
    const third = worldOf(scenario).repeated[2];
    if (third === undefined) throw new Error('the third run has not happened in this scenario');
    for (const label of diagnosisLabels) {
      expect(third.stderr, `the diagnosis of the third run: ${label}`).toContain(label);
    }
  },
);

Then(/^a fourth run exits 3 without running the command and prints the same diagnosis$/, ({ scenario }) => {
  const gate = requireGate(scenario);
  const run = runOn(scenario, gate, gate.command, { remember: false });
  expect(run.status, 'the fourth run').toBe(3);
  expect(run.stderr, 'the fourth run').not.toMatch(attemptLine);
  for (const label of diagnosisLabels)
    expect(run.stderr, `the diagnosis of the fourth run: ${label}`).toContain(label);
});

Then(/^the feature "([^"]+)" is blocked$/, ({ scenario }, feature: string) => {
  expect(invoke(scenario, ['status', '--feature', feature]).status, `${feature} is blocked`).toBe(1);
});

Then(/^the command is stopped after one minute$/, ({ scenario }) => {
  const seconds = durationOf(requireRun(scenario));
  expect(seconds, 'the seconds the command ran').toBeGreaterThanOrEqual(59.5);
  expect(seconds, 'the seconds the command ran').toBeLessThan(120);
});

Then(/^the wrapper exits (\d+)$/, ({ scenario }, status: string) => {
  expect(requireRun(scenario).status, 'the wrapper exit status').toBe(Number(status));
});

Then(/^the wrapper exits (\d+) without running the command$/, ({ scenario }, status: string) => {
  const run = requireRun(scenario);
  expect(run.status, 'the wrapper exit status').toBe(Number(status));
  expect(run.stderr, 'the wrapper output').not.toMatch(attemptLine);
});

Then(/^the wrapper names the "(.+)" signature$/, ({ scenario }, signature: string) => {
  expect(requireRun(scenario).stderr, 'the wrapper output').toContain(`signature "${signature}"`);
});

Then(/^the command runs$/, ({ scenario }) => {
  expect(requireRun(scenario).stderr, 'the wrapper output').toMatch(attemptLine);
});

Then(/^it says nothing changed since the last failure$/, ({ scenario }) => {
  expect(requireRun(scenario).stderr, 'the wrapper output').toContain(
    'nothing changed since the last failure',
  );
});

Then(/^the ledger keeps the refused rerun apart from the attempts$/, ({ scenario }) => {
  const key = keyOf(currentTarget(scenario));
  const row = unitRowOf(reportOf(scenario), key);
  expect(row?.[2], `attempts of ${key}`).toBe('1');
  expect(row?.[5], `refused reruns of ${key}`).toBe('1');
});

Then(/^the stop is counted$/, ({ scenario }) => {
  expect(stopFailures(scenario), 'counted red stops').toBe(1);
});

Then(/^the stop is not counted$/, ({ scenario }) => {
  expect(stopFailures(scenario), 'counted red stops').toBe(0);
});

Then(/^the Stop hook lets it stop$/, ({ scenario }) => {
  expect(worldOf(scenario).stop?.decision, 'the Stop hook decision').not.toBe('block');
});

Then(/^the Stop hook blocks the stop$/, ({ scenario }) => {
  expect(worldOf(scenario).stop?.decision, 'the Stop hook decision').toBe('block');
});

Then(/^the hook says the machine needs attention$/, ({ scenario }) => {
  expect(worldOf(scenario).stop?.systemMessage ?? '', 'the Stop hook message').toContain('needs attention');
});

Then(/^the gate does not deny it$/, ({ scenario }) => {
  expect(
    requireAnswer(scenario).decision,
    `gate decision (reason: ${requireAnswer(scenario).reason})`,
  ).not.toBe('deny');
});

Then(/^the gate does not ask$/, ({ scenario }) => {
  expect(
    requireAnswer(scenario).decision,
    `gate decision (reason: ${requireAnswer(scenario).reason})`,
  ).not.toBe('ask');
});

Then(/^the reason holds "(.+)"$/, ({ scenario }, text: string) => {
  expect(requireAnswer(scenario).reason, 'the gate reason').toContain(text);
});

Then(/^the unit "([^"]+)" has no attempts$/, ({ scenario }, key: string) => {
  expect(rowOf(scenario, key), `the status of ${key}`).toBeUndefined();
});

Then(/^the ledger keeps the reset with "(.+)" and its reason$/, ({ scenario }, by: string) => {
  const key = keyOf(currentTarget(scenario));
  const row = reportOf(scenario).resets.find((cells) => cells[0] === key);
  expect(row?.[1], `the reset of ${key} by`).toBe(by);
  expect(row?.[2], `the reason of the reset of ${key}`).toBe(worldOf(scenario).resetReason);
});

Then(/^the reset is refused with exit (\d+)$/, ({ scenario }, status: string) => {
  expect(requireRun(scenario).status, 'the reset exit status').toBe(Number(status));
});

Then(/^the refusal says the next reset is the maintainer's$/, ({ scenario }) => {
  expect(requireRun(scenario).stderr, 'the refusal').toMatch(/next reset .*maintainer's/);
});

Then(
  /^the report lists the reset with its unit, "(.+)", its reason and its time$/,
  ({ scenario }, by: string) => {
    const key = keyOf(currentTarget(scenario));
    const row = reportOf(scenario).resets.find((cells) => cells[0] === key);
    expect(row, `a reset row of ${key}`).toBeDefined();
    expect(row?.[1], `the reset of ${key} by`).toBe(by);
    expect(row?.[2], `the reason of the reset of ${key}`).toBe(worldOf(scenario).resetReason);
    expect(row?.[3] ?? '', 'the time of the reset').toMatch(/^\d{4}-\d{2}-\d{2}T/);
  },
);

Then(
  /^the report shows the machine failures and the refused reruns of each unit in columns of their own$/,
  ({ scenario }) => {
    const report = reportOf(scenario);
    expect(report.header, 'the report header').toContain('Environment failures');
    expect(report.header, 'the report header').toContain('Refused reruns');
    for (const row of report.units) {
      expect(row[4], `environment failures of ${row[0]}`).toMatch(/^\d+$/);
      expect(row[5], `refused reruns of ${row[0]}`).toMatch(/^\d+$/);
    }
    const other = unitRowOf(report, `gate:${currentTarget(scenario).feature}/T2`);
    expect(other?.[4], 'environment failures of the second unit').toBe('1');
    expect(other?.[5], 'refused reruns of the second unit').toBe('1');
  },
);

Then(/^"([^"]+)" holds all (\d+) lines$/, ({ scenario }, rel: string, lines: string) => {
  const text = readFileSync(path.join(repoOf(scenario), rel), 'utf8');
  expect(text.replace(/\n$/, '').split('\n').length, `lines of ${rel}`).toBe(Number(lines));
});

Then(
  /^the terminal shows the result, the duration and lines (\d+) to (\d+)$/,
  ({ scenario }, first: string, last: string) => {
    const run = requireRun(scenario);
    const shown = run.stdout.replace(/\n$/, '').split('\n');
    expect(shown[0], 'the first line on the terminal').toBe(`line ${first}`);
    expect(shown.at(-1), 'the last line on the terminal').toBe(`line ${last}`);
    expect(shown.length, 'the lines on the terminal').toBe(Number(last) - Number(first) + 1);
    expect(run.stderr, 'the result and the duration').toMatch(/exit 0 in \d+\.\d+s/);
  },
);

Then(/^rule 11 says environment failures and unchanged reruns do not count$/, ({ scenario }) => {
  const rule = ruleElevenOf(guideOf(scenario, 'AGENTS.md'));
  expect(rule, 'rule 11 of AGENTS.md').toMatch(/environment failures?[^.]*do not count/i);
  expect(rule, 'rule 11 of AGENTS.md').toMatch(/unchanged reruns?[^.]*do not count/i);
});

Then(
  /^rule 11 says the orchestrator resets a unit once with a reason and a second reset is the maintainer's$/,
  ({ scenario }) => {
    const rule = ruleElevenOf(guideOf(scenario, 'AGENTS.md'));
    expect(rule, 'rule 11 of AGENTS.md').toMatch(/orchestrator resets a unit once, with a reason/);
    expect(rule, 'rule 11 of AGENTS.md').toMatch(/second reset .*maintainer's/);
  },
);

Then(
  /^the reference describes the signatures, "env-blocked", exit 4 for an unchanged rerun, the orchestrator reset, the log files and the allowed filters$/,
  ({ scenario }) => {
    const reference = guideOf(scenario, retryBudgetReference);
    for (const name of ['docker', 'disk', 'killed', 'port', 'not-found', 'timeout']) {
      expect(reference, `the signature ${name}`).toContain(`\`${name}\``);
    }
    expect(reference, 'env-blocked').toContain('`env-blocked`');
    expect(reference, 'exit 4 for an unchanged rerun').toMatch(/exit 4/);
    expect(reference, 'the orchestrator reset').toContain('--by orchestrator');
    expect(reference, 'the log files').toContain('reports/attempts/<unit>/<n>.log');
    for (const filter of ['tail -n', 'head -n', 'grep']) {
      expect(reference, `the allowed filter ${filter}`).toContain(filter);
    }
  },
);
