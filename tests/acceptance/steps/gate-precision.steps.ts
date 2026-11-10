// Acceptance steps for gate-precision (ADR 023), one step per line of acceptance.feature that no other feature's steps
// already define. Black box: a temporary git repository with an approved phase brief on the branch feat/F0-demo, and
// .claude/hooks/gate.mjs of this checkout run as a child process with CLAUDE_PROJECT_DIR set to that repository. The
// gate reads the call on stdin and answers on stdout. Nothing here imports .claude/hooks/lib (rule
// acceptance-is-black-box). The gate world (support/gate-world.ts) holds the repository, the last answer and the
// temporary directories. The gate steps of harness-bootstrap and budget-v2 are reused, never defined again here.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Given, Then, When, type Scenario } from '../fixtures.ts';
import { answerOf, gateWorldOf, requireGateRepo, type GateAnswer } from '../support/gate-world.ts';

const maxOutputBytes = 16 * 1024 * 1024;
const hookTimeoutMs = 120_000;
const megabyte = 1024 * 1024;
const KEY = 'gate-precision';

// The state this feature's steps share within one scenario: every answer in order, the session the calls use, the
// raw output and exit status of the last call, and the script the scenario names (support/gate-world.ts holds the rest).
interface PrecisionWorld {
  answers: GateAnswer[];
  session: string;
  status: number | null;
  output: string;
  scriptDir: string | undefined;
  scriptDoes: string | undefined;
  scriptFile: string | undefined;
}

function precisionWorldOf(scenario: Scenario): PrecisionWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as PrecisionWorld;
  const created: PrecisionWorld = {
    answers: [],
    session: 'gate-precision-a',
    status: null,
    output: '',
    scriptDir: undefined,
    scriptDoes: undefined,
    scriptFile: undefined,
  };
  scenario.values.set(KEY, created);
  return created;
}

// The environment without the GIT_* variables a git hook exports: a child git must act on its own repository.
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=d2rmm acceptance',
      '-c',
      'user.email=acceptance@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', env: cleanEnv(), maxBuffer: maxOutputBytes },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
}

function writeFile(filePath: string, text: string | Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

// A directory outside the repository, removed by the After hook of harness-bootstrap with the other gate directories.
function temporaryDirectory(scenario: Scenario, prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  gateWorldOf(scenario).temporary.push(dir);
  return dir;
}

// Small stand-ins for the files the read-only examples of acceptance.feature read inside the checkout.
const readOnlyFiles: Record<string, string> = {
  'AGENTS.md': '# AGENTS\n\nA stand-in for the agent guide.\n',
  '.claude/hooks/gate.mjs': '// A stand-in for the gate hook.\n',
  '.claude/hooks/lib/gate-rules.mjs': '// A stand-in for the gate rules.\n',
  '.quality-baseline.json': '{"metrics":{}}\n',
  'scripts/lib/budget.mjs': '// A stand-in for the retry budget.\n',
  'apps/api/package.json': '{"name":"api"}\n',
};

// The phase brief the gate reads from the main checkout: the approval line of the phase and its feature table.
function briefOf(phase: string): string {
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
    '',
    '## Delegation',
    '',
    '- [ ] harness-self',
    '',
  ].join('\n');
}

// One call to the gate in the scenario's repository. The answer and the raw output are kept for the Then steps.
function invoke(scenario: Scenario, stdin: string): GateAnswer {
  const gate = gateWorldOf(scenario);
  const world = precisionWorldOf(scenario);
  const repo = requireGateRepo(gate);
  const script = path.join(scenario.repoRoot, '.claude', 'hooks', 'gate.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    input: stdin,
    encoding: 'utf8',
    env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo },
    maxBuffer: maxOutputBytes,
    timeout: hookTimeoutMs,
  });
  if (result.error) throw result.error;
  world.status = result.status;
  world.output = `${result.stdout}${result.stderr}`;
  const answer = answerOf(result.stdout.trim());
  gate.answer = answer;
  world.answers.push(answer);
  return answer;
}

// A PreToolUse call of `payload` in `session`, in the scenario's repository.
function callInSession(scenario: Scenario, payload: Record<string, unknown>, session: string): GateAnswer {
  const repo = requireGateRepo(gateWorldOf(scenario));
  return invoke(
    scenario,
    JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, cwd: repo, ...payload }),
  );
}

function bashIn(scenario: Scenario, command: string, session: string): GateAnswer {
  return callInSession(scenario, { tool_name: 'Bash', tool_input: { command } }, session);
}

function requireAnswer(scenario: Scenario): GateAnswer {
  const answer = gateWorldOf(scenario).answer;
  if (answer === undefined) throw new Error('the gate has not been asked in this scenario');
  return answer;
}

// The text of a script the scenario describes, in the language of its runner (python3 or bash).
function scriptText(world: PrecisionWorld, runner: string): { file: string; text: string } {
  const dir = world.scriptDir ?? '';
  const python = runner === 'python3';
  const file = path.join(dir, python ? 'script.py' : 'script.sh');
  switch (world.scriptDoes) {
    case 'prints the lines of AGENTS.md':
      return { file, text: python ? "print(open('AGENTS.md').read())\n" : 'cat AGENTS.md\n' };
    case 'writes eslint.config.mjs':
      return {
        file,
        text: python ? "open('eslint.config.mjs', 'w').write('')\n" : 'echo x > eslint.config.mjs\n',
      };
    case 'runs git push --force origin main':
      return { file, text: 'git push --force origin main\n' };
    case 'sources another one there': {
      const other = path.join(dir, 'other.sh');
      writeFile(other, 'echo hello\n');
      return { file, text: `. ${other}\n` };
    }
    default:
      throw new Error(`no script text for "${world.scriptDoes ?? ''}"`);
  }
}

Given(
  /^a temporary repository with an approved phase brief for "(F\d+)" on the branch "([^"]+)"$/,
  ({ scenario }, phase: string, branch: string) => {
    const gate = gateWorldOf(scenario);
    const dir = temporaryDirectory(scenario, 'd2rmm-gp-');
    gate.repo = dir;
    git(dir, ['init', '-q', '-b', 'main']);
    // The files the read-only examples name: a read of a file the checkout lacks gets no decision, so they exist here.
    for (const [rel, text] of Object.entries(readOnlyFiles)) writeFile(path.join(dir, rel), text);
    writeFile(path.join(dir, '.specs', 'phases', phase, 'brief.md'), briefOf(phase));
    writeFile(path.join(dir, '.specs', 'phases', 'ACTIVE'), `${phase}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `chore: phase ${phase} brief`]);
    git(dir, ['branch', `phase/${phase}`]);
    git(dir, ['checkout', '-q', '-b', branch]);
  },
);

Given(/^a script outside the repository that (.+)$/, ({ scenario }, does: string) => {
  const world = precisionWorldOf(scenario);
  world.scriptDir = temporaryDirectory(scenario, 'd2rmm-gp-script-');
  world.scriptDoes = does;
  world.scriptFile = undefined;
});

Given(/^a script path that does not exist$/, ({ scenario }) => {
  const world = precisionWorldOf(scenario);
  world.scriptFile = path.join(temporaryDirectory(scenario, 'd2rmm-gp-missing-'), 'missing.sh');
});

Given(/^a binary file outside the repository$/, ({ scenario }) => {
  const world = precisionWorldOf(scenario);
  const file = path.join(temporaryDirectory(scenario, 'd2rmm-gp-binary-'), 'blob.bin');
  writeFile(file, Buffer.from([0x7f, 0x45, 0x00, 0xff, 0x00, 0x01]));
  world.scriptFile = file;
});

When(/^the agent asks the gate to run that script with "([^"]+)"$/, ({ scenario }, runner: string) => {
  const world = precisionWorldOf(scenario);
  let file = world.scriptFile;
  if (file === undefined) {
    const script = scriptText(world, runner);
    writeFile(script.file, script.text);
    file = script.file;
  }
  bashIn(scenario, `${runner} ${file}`, world.session);
});

When(
  /^the agent asks the gate to run "(.+)" (\d+) times in one session$/,
  ({ scenario }, command: string, count: string) => {
    const world = precisionWorldOf(scenario);
    for (let i = 0; i < Number(count); i += 1) bashIn(scenario, command, world.session);
  },
);

When(
  /^the agent asks the gate to run "(.+)" (\d+) times in one session and (\d+) times in another$/,
  ({ scenario }, command: string, first: string, second: string) => {
    const world = precisionWorldOf(scenario);
    world.session = 'gate-precision-a';
    for (let i = 0; i < Number(first); i += 1) bashIn(scenario, command, world.session);
    world.session = 'gate-precision-b';
    for (let i = 0; i < Number(second); i += 1) bashIn(scenario, command, world.session);
  },
);

When(
  /^the agent asks the gate to run "(.+)" once more in the same session$/,
  ({ scenario }, command: string) => {
    const world = precisionWorldOf(scenario);
    bashIn(scenario, command, world.session);
  },
);

When(
  /^the agent asks the gate to run a command line of "(.+)" and "(.+)" on two lines$/,
  ({ scenario }, first: string, second: string) => {
    bashIn(scenario, `${first}\n${second}`, precisionWorldOf(scenario).session);
  },
);

When(/^the agent sends the gate (.+)$/, ({ scenario }, input: string) => {
  const world = precisionWorldOf(scenario);
  const repo = requireGateRepo(gateWorldOf(scenario));
  switch (input) {
    case 'a Write of a 60 MB file':
      callInSession(
        scenario,
        {
          tool_name: 'Write',
          tool_input: { file_path: path.join(repo, 'big.txt'), content: 'a'.repeat(60 * megabyte) },
        },
        world.session,
      );
      break;
    case 'a Write of a 60 MB file to apps/api/.env':
      callInSession(
        scenario,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: path.join(repo, 'apps', 'api', '.env'),
            content: 'a'.repeat(60 * megabyte),
          },
        },
        world.session,
      );
      break;
    case 'a Bash command of 2 MB':
      bashIn(scenario, `cat AGENTS.md; ${'x'.repeat(2 * megabyte)}`, world.session);
      break;
    case 'a payload that is not JSON':
      invoke(scenario, 'not json {');
      break;
    case 'a Bash call with no command':
      callInSession(scenario, { tool_name: 'Bash', tool_input: {} }, world.session);
      break;
    default:
      throw new Error(`no gate input is named "${input}"`);
  }
});

Then(
  /^the gate answers "(allow|ask|deny)" with a reason that names the task notification$/,
  ({ scenario }, decision: string) => {
    const answer = requireAnswer(scenario);
    expect(answer.decision, `gate decision (reason: ${answer.reason})`).toBe(decision);
    expect(answer.reason, 'the gate reason').toContain('task notification');
  },
);

Then(/^the gate neither asks nor denies$/, ({ scenario }) => {
  const answer = requireAnswer(scenario);
  expect(['ask', 'deny'], `gate decision (reason: ${answer.reason})`).not.toContain(answer.decision);
});

Then(/^the gate allowed each of them$/, ({ scenario }) => {
  const answers = precisionWorldOf(scenario).answers;
  expect(answers.length, 'the calls the gate answered').toBeGreaterThan(0);
  for (const answer of answers) {
    expect(answer.decision, `gate decision (reason: ${answer.reason})`).toBe('allow');
  }
});

// GPR-13: a line that is not a script is never asked about as one; a script ask names the script.
Then(/^the gate does not ask about a script$/, ({ scenario }) => {
  const answer = requireAnswer(scenario);
  if (answer.decision === 'ask') {
    expect(answer.reason, 'the gate reason of an ask').not.toContain('script');
  }
});

Then(/^the gate's output carries no "(.+)"$/, ({ scenario }, text: string) => {
  const world = precisionWorldOf(scenario);
  expect(world.status, 'the gate exit status').toBe(0);
  expect(world.output, 'the gate output').not.toContain(text);
});
