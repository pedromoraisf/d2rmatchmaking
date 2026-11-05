// Acceptance steps for load-baseline (ADR 023), one step per line of the @LB-16, @LB-17 and @LB-18 scenarios. Black box:
// each step runs `node scripts/load/run.mjs` or `node scripts/load/publish.mjs` in a child process, with a temporary root,
// a temporary TMPDIR and a `docker` shim first on PATH, and asserts on the exit code, the message, the shim's log and the
// files. Nothing here imports apps/ or packages/ (rule acceptance-is-black-box). The load itself never runs here: every
// scenario stops before its first container.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, type Scenario } from '../fixtures.ts';

const KEY = 'load-baseline';
const commandTimeoutMs = 60_000;
const LOAD_ENTRY = path.join('scripts', 'load', 'run.mjs');
const PUBLISH_ENTRY = path.join('scripts', 'load', 'publish.mjs');
const DOCUMENT = path.join('docs', 'engineering', 'load-baseline.md');

// The child never inherits the variables that could point the run at another target, daemon or collector, nor the
// PATH and TMPDIR it needs replaced: a developer's shell cannot change what these scenarios prove.
const NOT_INHERITED_NAMES = ['DATABASE_URL', 'PATH', 'TMPDIR'];
const NOT_INHERITED_PREFIXES = ['LOAD_', 'DOCKER_', 'OTEL_'];

// The Docker states of the scenarios (LB-18), and the shim behaviour each one gives.
type DockerState = 'running' | 'down' | 'no-pull' | 'missing';

interface CommandRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface LoadWorld {
  root: string; // the temporary root: the summary, the document and the shim
  bin: string; // first on the child's PATH; holds the docker shim, or nothing when Docker is not installed
  tmp: string; // the child's TMPDIR: the run's lock directory and work directories land here, never in the real tmp
  log: string; // the shim appends one line per docker call here
  docker: DockerState;
  extra: Record<string, string>; // variables set for the child only
  summary: string | undefined; // the kind of summary the publish scenario names
  run: CommandRun | undefined;
}

// A docker shim: it logs its arguments and answers as its state says. `down` is the daemon that does not answer; `no-pull`
// answers every call but the pull of the k6 image, which the build needs. No call is ever a `run` or a `create`, and a
// scenario fails if one happens.
const SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$D2RMM_SHIM_LOG"
case "$D2RMM_SHIM_STATE" in
  down)
    echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2
    exit 1 ;;
  no-pull)
    case "$*" in
      *d2rmm-load-k6*)
        echo "pull access denied for grafana/k6, repository does not exist or may require 'docker login'" >&2
        exit 1 ;;
    esac ;;
esac
case "$1" in
  version) echo "27.0.0" ;;
esac
exit 0
`;

function worldOf(scenario: Scenario): LoadWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as LoadWorld;
  const root = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-load-acceptance-'));
  const world: LoadWorld = {
    root,
    bin: path.join(root, 'bin'),
    tmp: path.join(root, 'tmp'),
    log: path.join(root, 'docker.log'),
    docker: 'running',
    extra: {},
    summary: undefined,
    run: undefined,
  };
  mkdirSync(world.bin, { recursive: true });
  mkdirSync(world.tmp, { recursive: true });
  writeShim(world);
  scenario.values.set(KEY, world);
  return world;
}

function dockerStateOf(text: string): DockerState {
  switch (text) {
    case 'not installed':
      return 'missing';
    case 'installed but not running':
      return 'down';
    case 'running but cannot pull k6':
      return 'no-pull';
    default:
      throw new Error(`no Docker state is named "${text}"`);
  }
}

function writeShim(world: LoadWorld): void {
  const file = path.join(world.bin, 'docker');
  rmSync(file, { force: true });
  if (world.docker === 'missing') return;
  writeFileSync(file, SHIM, 'utf8');
  chmodSync(file, 0o755);
}

function childEnv(world: LoadWorld): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([name]) =>
      !NOT_INHERITED_NAMES.includes(name) &&
      !NOT_INHERITED_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  return {
    ...Object.fromEntries(inherited),
    PATH: world.bin,
    TMPDIR: world.tmp,
    LOAD_PROFILE: 'smoke',
    D2RMM_SHIM_LOG: world.log,
    D2RMM_SHIM_STATE: world.docker,
    ...world.extra,
  };
}

function spawnNode(script: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): CommandRun {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: commandTimeoutMs,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function requireRun(world: LoadWorld): CommandRun {
  if (world.run === undefined) throw new Error('no load command has run in this scenario');
  return world.run;
}

function tail(run: CommandRun): string {
  return `exit ${run.status}\n${`${run.stdout}${run.stderr}`.slice(-3000)}`;
}

/** Every line the docker shim logged: one per call, in order. */
function dockerCalls(world: LoadWorld): string[] {
  if (!existsSync(world.log)) return [];
  return readFileSync(world.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

function containerCalls(world: LoadWorld): string[] {
  return dockerCalls(world).filter((call) => /^(run|create)\b/u.test(call));
}

// A summary the publish command reads: the fields its plan checks are the ones that decide the refusal.
function summaryFixture(profile: 'full' | 'smoke', passed: boolean): Record<string, unknown> {
  return {
    profile,
    passed,
    error: null,
    failure: passed ? null : { step: 150, rule: 'latency' },
    maxConcurrentPlayers: passed ? 100 : 0,
    maxConcurrentRooms: 0,
    bytesPerPlayerHour: 60000,
    p95StateLatencyMs: 300,
    ceilingReached: false,
    withinEgressBudget: true,
    limits: { cpus: '0.5', memory: '512m', k6Memory: '1500m' },
    versions: {
      k6: '2.3.0',
      sseExtension: '0.2.0',
      node: '26',
      postgres: '17',
      apiImage: 'd2rmm-load-api:f0',
    },
    commit: 'abc1234',
    startedAt: '2026-11-03T10:00:00.000Z',
    endedAt: '2026-11-03T10:20:00.000Z',
    steps: [],
  };
}

function writeSummary(world: LoadWorld, kind: string): void {
  world.summary = kind;
  if (kind === 'missing') return;
  const fixtures: Record<string, Record<string, unknown>> = {
    'from the smoke profile': summaryFixture('smoke', true),
    'from a run that failed': summaryFixture('full', false),
  };
  const fixture = fixtures[kind];
  if (fixture === undefined) throw new Error(`no load summary is named "${kind}"`);
  const dir = path.join(world.root, 'reports', 'load');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(fixture), 'utf8');
}

// The word each refused summary's reason must name (publish.mjs prints the plan's reason).
const REASON_OF: Record<string, string> = {
  missing: 'missing',
  'from the smoke profile': 'smoke',
  'from a run that failed': 'did not pass',
};

After(({ scenario }) => {
  const stored = scenario.values.get(KEY) as LoadWorld | undefined;
  if (stored !== undefined) rmSync(stored.root, { recursive: true, force: true });
});

Given("a maintainer's machine with the repository checked out", ({ scenario }) => {
  for (const entry of [LOAD_ENTRY, PUBLISH_ENTRY]) {
    expect(existsSync(path.join(scenario.repoRoot, entry)), `${entry} is in the checkout`).toBe(true);
  }
});

// LB-17
Given(
  /^the environment variable "([^"]+)" is set to "([^"]*)"$/,
  ({ scenario }, name: string, value: string) => {
    worldOf(scenario).extra[name] = value;
  },
);

When('the maintainer starts the load run', ({ scenario }) => {
  const world = worldOf(scenario);
  world.run = spawnNode(path.join(scenario.repoRoot, LOAD_ENTRY), [], childEnv(world), scenario.repoRoot);
});

Then('the run is refused before any request is sent', ({ scenario }) => {
  const world = worldOf(scenario);
  const run = requireRun(world);
  expect(run.status, tail(run)).toBe(2);
  expect(dockerCalls(world), 'docker calls before the refusal').toEqual([]);
});

Then(/^the refusal names "([^"]+)"$/, ({ scenario }, name: string) => {
  const world = worldOf(scenario);
  const run = requireRun(world);
  expect(run.stderr, tail(run)).toContain(name);
  // A value can hold credentials (DATABASE_URL), so the refusal never prints it.
  const value = world.extra[name];
  if (value !== undefined)
    expect(`${run.stdout}${run.stderr}`, 'the refusal does not print the value').not.toContain(value);
});

Then('no container was started', ({ scenario }) => {
  expect(containerCalls(worldOf(scenario)), 'docker run or create calls').toEqual([]);
});

// LB-18
Given(/^Docker is in this state: "([^"]+)"$/, ({ scenario }, state: string) => {
  const world = worldOf(scenario);
  world.docker = dockerStateOf(state);
  writeShim(world);
});

Then('the run fails before it starts any container', ({ scenario }) => {
  const world = worldOf(scenario);
  const run = requireRun(world);
  expect(run.status, tail(run)).toBe(2);
  expect(containerCalls(world), 'docker run or create calls').toEqual([]);
});

Then(/^the failure names "([^"]+)"$/, ({ scenario }, name: string) => {
  const run = requireRun(worldOf(scenario));
  // The image failure names "the image" and its reference; Docker failures name "Docker".
  const expected = name === 'image' ? 'the image' : name;
  expect(run.stderr, tail(run)).toContain(expected);
});

// LB-16
Given(/^the load summary is "([^"]+)"$/, ({ scenario }, kind: string) => {
  writeSummary(worldOf(scenario), kind);
});

When('the maintainer publishes the load baseline', ({ scenario }) => {
  const world = worldOf(scenario);
  world.run = spawnNode(
    path.join(scenario.repoRoot, PUBLISH_ENTRY),
    ['--root', world.root],
    childEnv(world),
    scenario.repoRoot,
  );
});

Then('the publish is refused', ({ scenario }) => {
  const world = worldOf(scenario);
  const run = requireRun(world);
  expect(run.status, tail(run)).toBe(1);
  expect(run.stderr, tail(run)).toContain('not published');
  const reason = REASON_OF[world.summary ?? ''];
  expect(reason, `the refusal reason of "${world.summary}"`).toBeDefined();
  expect(run.stderr, tail(run)).toContain(reason ?? '');
});

Then('the load baseline document is not written', ({ scenario }) => {
  const world = worldOf(scenario);
  expect(existsSync(path.join(world.root, DOCUMENT)), 'the document under the temporary root').toBe(false);
});
