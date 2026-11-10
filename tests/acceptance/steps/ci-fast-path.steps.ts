// Acceptance steps for ci-fast-path (ADR 023), one step per line of acceptance.feature. Black box: the steps read the
// repository's workflow, ruleset and Dependabot files. Nothing here imports scripts/lib or apps/ (rule acceptance-is-black-box).
//
// Reused as written from harness-foundation.steps.ts: the Background, "the contributor reads the CI workflow", "the
// contributor reads the nightly workflow" and "the check fails". Those steps keep their results under that file's
// key in the scenario values, so the steps here read the same key.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { parse } from 'yaml';
import { When, Then, type Scenario } from '../fixtures.ts';

const SHARED_KEY = 'harness-foundation';
const OWN_KEY = 'ci-fast-path';
const NEW_JOBS = ['smoke', 'agent-build'];
const AGENT_CRATES = ['domain', 'core', 'adapters'];

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}

interface Job {
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  services?: Record<string, { image?: string }>;
  env?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

interface Group {
  patterns?: string[];
  'exclude-patterns'?: string[];
  'dependency-type'?: string;
  'update-types'?: string[];
}

interface Dependabot {
  updates: {
    'package-ecosystem': string;
    schedule?: { interval?: string };
    cooldown?: { 'semver-major-days'?: number; include?: string[] };
    groups?: Record<string, Group>;
  }[];
}

interface Ruleset {
  rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
}

// The Render blueprint: the install and start commands the smoke job reproduces (AD-161).
interface Render {
  services: { buildCommand?: string; startCommand?: string }[];
}

interface CheckResult {
  status: number | null;
  output: string;
  rules: string[];
}

// The values this feature's steps share within one scenario.
interface OwnWorld {
  copy?: string;
  job?: string;
  ruleset?: Ruleset;
  dependabot?: Dependabot;
}

// The values the shared steps of harness-foundation.steps.ts keep under their key.
interface SharedWorld {
  workflow?: Workflow;
  check?: CheckResult;
  [field: string]: unknown;
}

function own(scenario: Scenario): OwnWorld {
  const stored = scenario.values.get(OWN_KEY);
  if (stored !== undefined) return stored as OwnWorld;
  const created: OwnWorld = {};
  scenario.values.set(OWN_KEY, created);
  return created;
}

function shared(scenario: Scenario): SharedWorld {
  const stored = scenario.values.get(SHARED_KEY);
  if (stored !== undefined) return stored as SharedWorld;
  const created: SharedWorld = { runs: [], workspaces: [], tsconfigs: [], documents: [] };
  scenario.values.set(SHARED_KEY, created);
  return created;
}

function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

function readRepo(scenario: Scenario, file: string): string {
  return readFileSync(path.join(scenario.repoRoot, file), 'utf8');
}

function workflowOf(scenario: Scenario): Workflow {
  const workflow = shared(scenario).workflow;
  if (workflow === undefined) throw new Error('no workflow has been read in this scenario');
  return workflow;
}

function jobNamed(scenario: Scenario, name: string): Job {
  const job = workflowOf(scenario).jobs[name];
  if (job === undefined) throw new Error(`the workflow has no job "${name}"`);
  return job;
}

// The job the last "a job ... needs only" line named: "it" in the scenarios refers to it.
function currentJob(scenario: Scenario): Job {
  const name = own(scenario).job;
  if (name === undefined) throw new Error('no job has been named in this scenario');
  return jobNamed(scenario, name);
}

function needsOf(job: Job): string[] {
  return [job.needs ?? []].flat().sort();
}

function runsOf(job: Job): string[] {
  return (job.steps ?? []).map((step) => step.run ?? '');
}

function stepWith(job: Job, predicate: (step: Step) => boolean, what: string): Step {
  const found = (job.steps ?? []).find(predicate);
  if (found === undefined) throw new Error(`no step ${what}`);
  return found;
}

// A glob with `*` as the only wildcard, anchored at both ends.
function globMatches(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'u').test(name);
}

function anyGlob(patterns: string[] | undefined, name: string): boolean {
  return (patterns ?? []).some((pattern) => globMatches(pattern, name));
}

function npmOf(scenario: Scenario): Dependabot['updates'][number] {
  const dependabot = own(scenario).dependabot;
  if (dependabot === undefined)
    throw new Error('the Dependabot configuration has not been read in this scenario');
  const npm = dependabot.updates.find((update) => update['package-ecosystem'] === 'npm');
  if (npm === undefined) throw new Error('the Dependabot configuration has no npm entry');
  return npm;
}

// The first group, in file order, that takes an update: Dependabot's rule (ADR 025 reviews of CFP-20).
function firstGroupFor(
  groups: Record<string, Group>,
  update: { name: string; type: string; dependencyType: string },
): string | undefined {
  for (const [name, group] of Object.entries(groups)) {
    if (group.patterns !== undefined && !anyGlob(group.patterns, update.name)) continue;
    if (anyGlob(group['exclude-patterns'], update.name)) continue;
    if (group['dependency-type'] !== undefined && group['dependency-type'] !== update.dependencyType)
      continue;
    if (group['update-types'] !== undefined && !group['update-types'].includes(update.type)) continue;
    return name;
  }
  return undefined;
}

// CFP-01, CFP-07, CFP-24: the CI workflow's verify job runs no mutation and keeps its sensors.
Then(/^the verify job does not run "(.+)"$/, ({ scenario }, text: string) => {
  for (const run of runsOf(jobNamed(scenario, 'verify')))
    expect(run, 'a run step of verify').not.toContain(text);
});

Then(
  /^the integration job needs exactly "([^"]+)" and "([^"]+)"$/,
  ({ scenario }, first: string, second: string) => {
    expect(needsOf(jobNamed(scenario, 'integration')), 'needs of integration').toEqual(
      [first, second].sort(),
    );
  },
);

const VERIFY_COMMANDS: Record<string, string> = {
  format: 'pnpm run format:check',
  lint: 'pnpm run lint',
  typecheck: 'pnpm run typecheck',
  architecture: 'pnpm run arch',
  'unit tests': 'pnpm test',
  'the specs check': 'pnpm run specs:check',
  'the contracts check': 'pnpm run contracts:check',
  'the PR ratchet': 'pnpm run quality:gate',
};

Then(/^the verify job still runs (.+)$/, ({ scenario }, list: string) => {
  const lines = runsOf(jobNamed(scenario, 'verify')).flatMap((run) =>
    run.split('\n').map((line) => line.trim()),
  );
  for (const phrase of list.split(/, | and /u)) {
    const command = VERIFY_COMMANDS[phrase];
    expect(command, `a command for "${phrase}"`).toBeDefined();
    expect(lines, `verify runs ${command ?? phrase}`).toContain(command);
  }
});

// CFP-10: the nightly agent mutation runs on Linux with its commands and report paths unchanged.
Then(/^the agent mutation job runs on "([^"]+)"$/, ({ scenario }, runner: string) => {
  expect(jobNamed(scenario, 'agent-mutation')['runs-on'], 'runner of the nightly agent mutation').toBe(
    runner,
  );
  own(scenario).job = 'agent-mutation';
});

Then('its three cargo mutants commands and report paths are the ones it had before', ({ scenario }) => {
  const commands = runsOf(currentJob(scenario)).filter((run) => run.includes('cargo mutants'));
  expect(commands.length, 'cargo mutants commands in the nightly').toBe(AGENT_CRATES.length);
  for (const crate of AGENT_CRATES) {
    const command = commands.find((run) => run.includes(`--package d2rmm-agent-${crate} `));
    expect(command, `cargo mutants for ${crate}`).toBeDefined();
    expect(command ?? '', `${crate} report path`).toMatch(
      new RegExp(`--output reports/mutation/agent-${crate}( |$)`, 'u'),
    );
    expect(command ?? '', `${crate} unit tests only`).toMatch(/ -- --lib$/u);
  }
});

// CFP-13, CFP-14: the ruleset of main.
When('the contributor reads the ruleset of main', ({ scenario }) => {
  own(scenario).ruleset = JSON.parse(
    readRepo(scenario, path.join('.github', 'rulesets', 'main.json')),
  ) as Ruleset;
});

function requiredChecks(scenario: Scenario): string[] {
  const ruleset = own(scenario).ruleset;
  if (ruleset === undefined) throw new Error('the ruleset of main has not been read in this scenario');
  const rule = ruleset.rules.find((candidate) => candidate.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((check) => check.context);
}

Then(/^its required checks are exactly (".+")$/, ({ scenario }, names: string) => {
  expect([...requiredChecks(scenario)].sort(), 'required checks of main').toEqual([...quoted(names)].sort());
});

Then(/^none of (".+") is required$/, ({ scenario }, names: string) => {
  const required = requiredChecks(scenario);
  for (const name of quoted(names)) expect(required, `${name} is required`).not.toContain(name);
});

// CFP-15, CFP-17, CFP-18, CFP-19, CFP-25: the smoke and agent-build jobs of the CI workflow.
Then(
  /^a job "([^"]+)" runs on pull requests with a Postgres service container$/,
  ({ scenario }, name: string) => {
    const job = jobNamed(scenario, name);
    expect(job.if ?? '', `condition of ${name}`).toContain("github.event_name == 'pull_request'");
    const images = Object.values(job.services ?? {}).map((service) => service.image ?? '');
    expect(
      images.some((image) => image.startsWith('postgres:')),
      `${name} service images`,
    ).toBe(true);
    own(scenario).job = name;
  },
);

Then(
  /^it installs the workspace, runs the migrations and starts the API with the commands of (".+")$/,
  ({ scenario }, files: string) => {
    // The files the scenario names: the Render blueprint at the root, the deploy workflow under .github/workflows.
    const locations: Record<string, string> = {
      'render.yaml': 'render.yaml',
      'deploy-api.yml': path.join('.github', 'workflows', 'deploy-api.yml'),
    };
    const [renderName = '', deployName = ''] = quoted(files);
    const renderFile = locations[renderName] ?? '';
    const deployFile = locations[deployName] ?? '';
    expect(renderFile, `${renderName} is a file the scenario may name`).not.toBe('');
    expect(deployFile, `${deployName} is a file the scenario may name`).not.toBe('');
    const render = (parse(readRepo(scenario, renderFile)) as Render).services[0];
    const deploy = parse(readRepo(scenario, deployFile)) as Workflow;
    const deployMigrate = (deploy.jobs['deploy']?.steps ?? [])
      .map((step) => step.run ?? '')
      .find((run) => run.includes('db:migrate'));
    const runs = runsOf(currentJob(scenario)).map((run) => run.trim());
    expect(render?.buildCommand ?? '', 'the Render install').toContain(
      'pnpm install --frozen-lockfile --ignore-scripts',
    );
    expect(runs, 'the workspace install').toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(deployMigrate, 'the migration of deploy-api.yml').toBeDefined();
    expect(runs, 'the migrations as deploy-api.yml runs them').toContain(deployMigrate?.trim());
    expect(
      runs.some((run) => run.includes(render?.startCommand ?? '')),
      'the start command of render.yaml',
    ).toBe(true);
  },
);

Then(/^it requests "([^"]+)"$/, ({ scenario }, route: string) => {
  const probe = runsOf(currentJob(scenario)).find((run) => run.includes('scripts/ci/smoke-healthz.mjs'));
  expect(probe, 'the smoke script runs').toBeDefined();
  expect(probe ?? '', `the probe requests ${route}`).toContain(route);
});

Then('none of the new jobs reads a repository secret', ({ scenario }) => {
  for (const name of NEW_JOBS) {
    expect(JSON.stringify(jobNamed(scenario, name)), `${name} reads no secret`).not.toContain('secrets.');
  }
});

Then(
  /^every action of the new jobs outside "([^"]+)" is pinned by a full commit SHA$/,
  ({ scenario }, owner: string) => {
    for (const name of NEW_JOBS) {
      for (const step of jobNamed(scenario, name).steps ?? []) {
        if (step.uses === undefined || step.uses.startsWith(owner)) continue;
        expect(step.uses, `${name} pins ${step.uses}`).toMatch(/@[0-9a-f]{40}$/u);
      }
    }
  },
);

Then(
  /^a job "([^"]+)" runs on a Windows runner on pull requests that change a file under "([^"]+)"$/,
  ({ scenario }, name: string, dir: string) => {
    const job = jobNamed(scenario, name);
    expect(job['runs-on'] ?? '', `runner of ${name}`).toMatch(/^windows-/u);
    expect(job.if ?? '', `condition of ${name}`).toContain("github.event_name == 'pull_request'");
    expect(job.if ?? '', `condition of ${name}`).toContain("needs.detect.outputs.agent == 'true'");
    const changed = stepWith(job, (step) => step.id === 'changed', 'with the id changed');
    expect(changed.run ?? '', 'the change check').toContain(dir.replace(/\/$/u, ''));
    own(scenario).job = name;
  },
);

Then(/^it runs "([^"]+)" with no signing key in its environment$/, ({ scenario }, command: string) => {
  const job = currentJob(scenario);
  expect(
    runsOf(job).some((run) => run.includes(command)),
    `a step runs ${command}`,
  ).toBe(true);
  expect(JSON.stringify(job), 'no signing key reaches the job').not.toContain('TAURI_SIGNING');
});

// CFP-20, CFP-21, CFP-22: the Dependabot configuration.
When('the contributor reads the Dependabot configuration', ({ scenario }) => {
  own(scenario).dependabot = parse(readRepo(scenario, path.join('.github', 'dependabot.yml'))) as Dependabot;
});

Then(
  /^major npm updates of the eslint family form one group and those of "([^"]+)" another$/,
  ({ scenario }, scope: string) => {
    const groups = npmOf(scenario).groups ?? {};
    const major = (name: string) =>
      firstGroupFor(groups, { name, type: 'major', dependencyType: 'development' });
    const eslintGroup = major('eslint');
    expect(eslintGroup, 'the group of an eslint major').toBeDefined();
    for (const name of ['@eslint/js', 'eslint-plugin-react', 'typescript-eslint']) {
      expect(major(name), `the group of a major of ${name}`).toBe(eslintGroup);
    }
    // The scope names a family by its glob: a package of that family stands for it.
    const telemetryGroup = major(scope.replace('*', 'api'));
    expect(telemetryGroup, `the group of a major of ${scope}`).toBeDefined();
    expect(telemetryGroup, 'the two families take two groups').not.toBe(eslintGroup);
    expect(
      anyGlob(groups[telemetryGroup ?? '']?.patterns, scope.replace('*', 'api')),
      'that group holds the family',
    ).toBe(true);
  },
);

Then(
  /^a major update of "([^"]+)" lands in the eslint group, not in "([^"]+)", taking the first group that matches$/,
  ({ scenario }, name: string, other: string) => {
    const groups = npmOf(scenario).groups ?? {};
    const landed = firstGroupFor(groups, { name, type: 'major', dependencyType: 'development' });
    expect(landed, `the group of a major of ${name}`).toBeDefined();
    expect(landed, `a major of ${name} is not in ${other}`).not.toBe(other);
    expect(Object.keys(groups), 'group order').toContain(other);
    expect(Object.keys(groups).indexOf(landed ?? ''), 'the eslint group comes first').toBeLessThan(
      Object.keys(groups).indexOf(other),
    );
    expect(anyGlob(groups[landed ?? '']?.patterns, name), `${landed} covers ${name}`).toBe(true);
  },
);

Then(
  /^a cooldown holds semver-major updates of those packages for (\d+) days$/,
  ({ scenario }, days: string) => {
    const cooldown = npmOf(scenario).cooldown;
    expect(cooldown?.['semver-major-days'], 'semver-major cooldown of npm').toBe(Number(days));
    for (const name of ['eslint', '@eslint/js', 'typescript-eslint', '@opentelemetry/api']) {
      expect(anyGlob(cooldown?.include, name), `${name} is held`).toBe(true);
    }
  },
);

const UNCHANGED_GROUPS: Record<string, Group> = {
  playwright: { patterns: ['@playwright/test', 'playwright', 'playwright-bdd'] },
  'dev-tooling': {
    'dependency-type': 'development',
    'exclude-patterns': ['@playwright/test', 'playwright', 'playwright-bdd'],
  },
};

Then(
  /^the npm schedule is still weekly with the "([^"]+)" and "([^"]+)" groups unchanged$/,
  ({ scenario }, first: string, second: string) => {
    const npm = npmOf(scenario);
    expect(npm.schedule?.interval, 'npm schedule').toBe('weekly');
    const groups = npm.groups ?? {};
    for (const name of [first, second]) {
      expect(groups[name], `the ${name} group`).toEqual(UNCHANGED_GROUPS[name]);
    }
  },
);
