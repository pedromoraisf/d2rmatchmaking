// Acceptance steps for harness-foundation (ADR 023), one step per line of acceptance.feature. Black box: each step
// runs a repository command or the architecture sensor in a child process, or reads a file, and asserts on the exit
// code, the output or the file. Nothing here imports apps/ or packages/ (rule acceptance-is-black-box).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { parse } from 'yaml';
import { Given, When, Then, test, type Scenario } from '../fixtures.ts';

const commandTimeoutMs = 300_000;
const maxOutputBytes = 64 * 1024 * 1024;

// The violations named in acceptance.feature, mapped to their fixture folders under scripts/test/fixtures/arch.
const fixtureFor: Record<string, string> = {
  'a domain file imports an adapter': 'domain-imports-adapter',
  'an application file imports an adapter': 'application-imports-adapter',
  "a module imports another module's internal": 'cross-module-internal',
  'a module file imports the composition root': 'module-imports-main',
};

interface CommandRun {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ArchitectureCheck {
  status: number | null;
  output: string;
  rules: string[];
}

interface ReleasePackage {
  'release-type': string;
  component: string;
  'include-component-in-tag': boolean;
  'tag-separator': string;
  'include-v-in-tag': boolean;
}

interface Baseline {
  metrics: Record<string, { value: number | null }>;
}

interface Release {
  config: { packages: Record<string, ReleasePackage> };
  manifest: Record<string, string>;
}

interface TurboTask {
  taskId: string;
  dependencies?: string[];
}

interface Metric {
  value: number | null;
  direction: string;
  floor: number;
  tolerance: number;
  contexts: string[];
  source: { type: string; path: string };
}

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  'continue-on-error'?: boolean;
}

interface Workflow {
  jobs: Record<string, { needs?: string | string[]; if?: string; steps?: WorkflowStep[] }>;
}

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface HarnessWorld {
  runs: CommandRun[];
  workspaces: string[];
  tsconfigs: string[];
  fixture: string | undefined;
  check: ArchitectureCheck | undefined;
  baseline: Baseline | undefined;
  release: Release | undefined;
  plan: TurboTask[] | undefined;
  workflow: Workflow | undefined;
  metric: Metric | undefined;
  agentCommands: string[] | undefined;
  skill: string | undefined;
  documents: string[];
}

function harness(scenario: Scenario): HarnessWorld {
  const key = 'harness-foundation';
  const stored = scenario.values.get(key);
  if (stored !== undefined) return stored as HarnessWorld;
  const created: HarnessWorld = {
    runs: [],
    workspaces: [],
    tsconfigs: [],
    fixture: undefined,
    check: undefined,
    baseline: undefined,
    release: undefined,
    plan: undefined,
    workflow: undefined,
    metric: undefined,
    agentCommands: undefined,
    skill: undefined,
    documents: [],
  };
  scenario.values.set(key, created);
  return created;
}

function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function isDirectory(dir: string): boolean {
  return existsSync(dir) && statSync(dir).isDirectory();
}

function tail(run: CommandRun): string {
  return `${run.command} exited ${run.status}\n${`${run.stdout}${run.stderr}`.slice(-3000)}`;
}

function shell(root: string, command: string): CommandRun {
  test.info().setTimeout(commandTimeoutMs);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    env,
    maxBuffer: maxOutputBytes,
  });
  return { command, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function lastRun(world: HarnessWorld): CommandRun {
  const run = world.runs.at(-1);
  if (!run) throw new Error('no command has run in this scenario');
  return run;
}

function listWorkspaces(root: string): { name: string; dir: string }[] {
  const listed = shell(root, 'pnpm ls -r --depth -1 --json');
  expect(listed.status, tail(listed)).toBe(0);
  const projects = JSON.parse(listed.stdout) as { name: string; path: string }[];
  return projects.map((project) => ({ name: project.name, dir: project.path }));
}

// Follows the extends chain of a tsconfig. It reaches the preset when a link is `<pkg>/...`, or when the chain ends in
// one of the two preset files of packages/config (the preset's own package).
function reachesPreset(file: string, pkg: string, root: string, seen = new Set<string>()): boolean {
  const presetFiles = [
    path.join(root, 'packages', 'config', 'tsconfig.base.json'),
    path.join(root, 'packages', 'config', 'tsconfig.dom.json'),
  ];
  if (presetFiles.includes(file)) return true;
  if (seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  const parent = readJson<{ extends?: unknown }>(file).extends;
  if (typeof parent !== 'string') return false;
  if (parent.startsWith(`${pkg}/`)) return true;
  if (parent.startsWith('.')) return reachesPreset(path.resolve(path.dirname(file), parent), pkg, root, seen);
  return false;
}

// `err` exits with the number of error violations; `json` always exits 0, so the rule names come from its output.
function cruise(root: string, dir: string, outputType: 'err' | 'json') {
  const depcruiseBin = path.join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
  return spawnSync(
    process.execPath,
    [
      depcruiseBin,
      '--config',
      path.join(root, '.dependency-cruiser.cjs'),
      '--output-type',
      outputType,
      'apps',
    ],
    { cwd: dir, encoding: 'utf8', maxBuffer: maxOutputBytes },
  );
}

function errorRules(jsonOutput: string): string[] {
  const report = JSON.parse(jsonOutput) as {
    summary: { violations: { rule: { name: string; severity: string } }[] };
  };
  const names = report.summary.violations.filter((v) => v.rule.severity === 'error').map((v) => v.rule.name);
  return [...new Set(names)].sort();
}

function requireCheck(world: HarnessWorld): ArchitectureCheck {
  if (!world.check) throw new Error('the architecture check has not run in this scenario');
  return world.check;
}

function requireBaseline(world: HarnessWorld): Baseline {
  if (!world.baseline) throw new Error('the quality baseline has not been read in this scenario');
  return world.baseline;
}

function requireRelease(world: HarnessWorld): Release {
  if (!world.release) throw new Error('the release configuration has not been read in this scenario');
  return world.release;
}

Given('a contributor has a clean checkout with dependencies installed', ({ scenario }) => {
  expect(existsSync(path.join(scenario.repoRoot, 'node_modules')), 'dependencies are installed').toBe(true);
});

// HF-01: six workspaces build, type-check and test together.
When('the contributor lists the workspaces', ({ scenario }) => {
  harness(scenario).workspaces = listWorkspaces(scenario.repoRoot).map((workspace) => workspace.name);
});

Then(/^the list holds (.+)$/, ({ scenario }, list: string) => {
  const names = harness(scenario).workspaces;
  expect(names.length, 'workspaces listed').toBeGreaterThan(0);
  for (const name of quoted(list)) expect(names, `workspace ${name}`).toContain(name);
});

When(/^the contributor runs (".+") from the repository root$/, ({ scenario }, commands: string) => {
  for (const command of quoted(commands)) harness(scenario).runs.push(shell(scenario.repoRoot, command));
});

Then('each command succeeds', ({ scenario }) => {
  for (const run of harness(scenario).runs) expect(run.status, tail(run)).toBe(0);
});

Then(/^each command ran in the workspaces (.+)$/, ({ scenario }, list: string) => {
  const names = quoted(list);
  for (const run of harness(scenario).runs) {
    const task = run.command.trim().split(/\s+/).at(-1) ?? '';
    const output = `${run.stdout}${run.stderr}`;
    for (const name of names) {
      expect(output, `${name}:${task} in "${run.command}"`).toContain(`${name}:${task}`);
    }
  }
});

// HF-02: every TypeScript workspace uses the shared presets.
When('the contributor lists the TypeScript configuration of every TypeScript workspace', ({ scenario }) => {
  harness(scenario).tsconfigs = listWorkspaces(scenario.repoRoot)
    .map((workspace) => path.join(workspace.dir, 'tsconfig.json'))
    .filter((file) => existsSync(file));
});

Then(/^every one extends the TypeScript preset of "(.+)"$/, ({ scenario }, pkg: string) => {
  const files = harness(scenario).tsconfigs;
  expect(files.length, 'TypeScript workspaces found').toBeGreaterThan(0);
  for (const file of files) {
    expect(
      reachesPreset(file, pkg, scenario.repoRoot),
      `${path.relative(scenario.repoRoot, file)} extends ${pkg}`,
    ).toBe(true);
  }
});

Then(/^the root lint and format configurations come from "(.+)"$/, ({ scenario }, pkg: string) => {
  const eslintConfig = readFileSync(path.join(scenario.repoRoot, 'eslint.config.mjs'), 'utf8');
  expect(eslintConfig, 'eslint.config.mjs re-exports the preset').toContain(`${pkg}/eslint`);
  const rootPackage = readJson<{ prettier?: unknown }>(path.join(scenario.repoRoot, 'package.json'));
  expect(rootPackage.prettier, 'prettier option of the root package').toBe(`${pkg}/prettier`);
  expect(existsSync(path.join(scenario.repoRoot, '.prettierrc.json')), 'no local Prettier file').toBe(false);
});

// HF-03: the architecture check rejects each deliberate layer violation.
Given(/^the violation fixture "(.+)"$/, ({ scenario }, violation: string) => {
  const folder = fixtureFor[violation];
  if (folder === undefined) throw new Error(`no fixture is named "${violation}"`);
  const dir = path.join(scenario.repoRoot, 'scripts', 'test', 'fixtures', 'arch', folder);
  expect(existsSync(dir), dir).toBe(true);
  harness(scenario).fixture = dir;
});

When('the contributor runs the architecture check on that fixture', ({ scenario }) => {
  const world = harness(scenario);
  if (world.fixture === undefined) throw new Error('no violation fixture is set in this scenario');
  const exitCheck = cruise(scenario.repoRoot, world.fixture, 'err');
  const jsonCheck = cruise(scenario.repoRoot, world.fixture, 'json');
  world.check = {
    status: exitCheck.status,
    output: `${exitCheck.stdout}${exitCheck.stderr}`,
    rules: errorRules(jsonCheck.stdout),
  };
});

Then('the check fails', ({ scenario }) => {
  const check = requireCheck(harness(scenario));
  expect(check.status, check.output).not.toBe(0);
});

Then(/^the failure names the rule "(.+)"$/, ({ scenario }, rule: string) => {
  const check = requireCheck(harness(scenario));
  expect(check.rules, 'error rules of the fixture').toEqual([rule]);
  expect(check.output, 'the failure output').toContain(rule);
});

// Shared by HF-04, HF-05 and HF-08: a single repository command, run from the repository root.
When(/^the contributor runs "([^"]+)"$/, ({ scenario }, command: string) => {
  harness(scenario).runs.push(shell(scenario.repoRoot, command));
});

Then('the command succeeds', ({ scenario }) => {
  const run = lastRun(harness(scenario));
  expect(run.status, tail(run)).toBe(0);
});

// HF-04: regenerated contracts leave no drift, and the documents describe the real routes and channels (AD-044).
Then(
  /^the OpenAPI document declares version "(.+)" and the path "(.+)"$/,
  ({ scenario }, version: string, route: string) => {
    const doc = readJson<{ openapi?: unknown; paths?: Record<string, unknown> }>(
      path.join(scenario.repoRoot, 'packages', 'contracts', 'openapi.json'),
    );
    expect(String(doc.openapi).startsWith(`${version}.`), `openapi ${String(doc.openapi)}`).toBe(true);
    expect(Object.keys(doc.paths ?? {}), 'OpenAPI paths').toContain(route);
  },
);

Then(
  /^the AsyncAPI document declares version "(.+)" and the channel "(.+)"$/,
  ({ scenario }, version: string, channel: string) => {
    const doc = readJson<{ asyncapi?: unknown; channels?: Record<string, unknown> }>(
      path.join(scenario.repoRoot, 'packages', 'contracts', 'asyncapi.json'),
    );
    expect(String(doc.asyncapi).startsWith(`${version}.`), `asyncapi ${String(doc.asyncapi)}`).toBe(true);
    expect(Object.keys(doc.channels ?? {}), 'AsyncAPI channels').toContain(channel);
  },
);

// HF-05: the five API modules exist with their three layers and a public entry point.
Given('the violation fixtures are present in the repository', ({ scenario }) => {
  for (const folder of new Set(Object.values(fixtureFor))) {
    const dir = path.join(scenario.repoRoot, 'scripts', 'test', 'fixtures', 'arch', folder);
    expect(isDirectory(dir), dir).toBe(true);
  }
});

Then(
  /^the API modules (.+) each have the layers (.+) and a public entry point$/,
  ({ scenario }, modules: string, layers: string) => {
    const apiModules = path.join(scenario.repoRoot, 'apps', 'api', 'src', 'modules');
    for (const name of quoted(modules)) {
      expect(existsSync(path.join(apiModules, name, 'index.ts')), `${name} public entry point`).toBe(true);
      for (const layer of quoted(layers)) {
        expect(isDirectory(path.join(apiModules, name, layer)), `${name} ${layer} layer`).toBe(true);
      }
    }
  },
);

// HF-07: the quality baseline holds the first measured values.
When('the contributor reads the quality baseline', ({ scenario }) => {
  harness(scenario).baseline = readJson<Baseline>(path.join(scenario.repoRoot, '.quality-baseline.json'));
});

Then(/^the metrics (.+) have a measured value$/, ({ scenario }, list: string) => {
  const metrics = requireBaseline(harness(scenario)).metrics;
  for (const name of quoted(list)) {
    const metric = metrics[name];
    expect(metric, `metric ${name}`).toBeDefined();
    expect(metric?.value, `${name} is measured`).not.toBeNull();
    expect(typeof metric?.value, `${name} is a number`).toBe('number');
  }
});

// HF-11: only the agent is released, with agent tags.
When('the contributor reads the release configuration', ({ scenario }) => {
  harness(scenario).release = {
    config: readJson<Release['config']>(path.join(scenario.repoRoot, 'release-please-config.json')),
    manifest: readJson<Release['manifest']>(path.join(scenario.repoRoot, '.release-please-manifest.json')),
  };
});

Then(
  /^"(.+)" is the only released package, starting at version "(.+)"$/,
  ({ scenario }, pkg: string, version: string) => {
    const { config, manifest } = requireRelease(harness(scenario));
    expect(Object.keys(config.packages), 'released packages').toEqual([pkg]);
    expect(manifest[pkg], `${pkg} in the release manifest`).toBe(version);
    const packageJson = readJson<{ version?: unknown }>(path.join(scenario.repoRoot, pkg, 'package.json'));
    expect(packageJson.version, `${pkg} package version`).toBe(version);
  },
);

Then(/^its release tags read "(.+)" followed by the version$/, ({ scenario }, prefix: string) => {
  const { config } = requireRelease(harness(scenario));
  const [pkg] = Object.keys(config.packages);
  const entry = pkg === undefined ? undefined : config.packages[pkg];
  if (entry === undefined) throw new Error('no released package is configured');
  expect(entry['include-component-in-tag'], 'tags include the component').toBe(true);
  const tagPrefix = `${entry.component}${entry['tag-separator']}${entry['include-v-in-tag'] ? 'v' : ''}`;
  expect(tagPrefix, 'tag prefix').toBe(prefix);
});

// ci-and-review-fixes (CRF-01 to CRF-24): the harness reads what the repository really produces.
const ciWorkflow = '.github/workflows/ci.yml';
const nightlyWorkflow = '.github/workflows/nightly.yml';
const qualityBaseline = '.quality-baseline.json';
const phaseSkill = '.claude/skills/d2rmm-phase-runner/SKILL.md';
const reviewTemplate = '.claude/skills/d2rmm-phase-runner/references/templates/review.md';
const agentCrates = ['domain', 'core', 'adapters'];

function readText(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

function readWorkflow(root: string, file: string): Workflow {
  return parse(readText(root, file)) as Workflow;
}

function requireWorkflow(world: HarnessWorld): Workflow {
  if (!world.workflow) throw new Error('no workflow has been read in this scenario');
  return world.workflow;
}

function requireMetric(world: HarnessWorld): Metric {
  if (!world.metric) throw new Error('the agent core metric has not been read in this scenario');
  return world.metric;
}

function requireSkill(world: HarnessWorld): string {
  if (world.skill === undefined)
    throw new Error('the phase runner instructions have not been read in this scenario');
  return world.skill;
}

// The value of a command's flag, as in `cargo mutants --package d2rmm-agent-core --output reports/x -- --lib`.
function flagValue(command: string, flag: string): string | undefined {
  return new RegExp(`(?:^|\\s)${flag}\\s+(\\S+)`).exec(command)?.[1];
}

// The cargo-mutants command of one crate among the commands of a source (the package script or the nightly job).
function mutantsFor(commands: string[], crate: string, source: string): string {
  const found = commands.find(
    (command) =>
      command.startsWith('cargo mutants') && flagValue(command, '--package') === `d2rmm-agent-${crate}`,
  );
  if (found === undefined) throw new Error(`${source} has no cargo-mutants command for d2rmm-agent-${crate}`);
  return found;
}

function nightlyMutants(workflow: Workflow, crate: string): string {
  const runs = (workflow.jobs['agent-mutation']?.steps ?? []).map((step) => step.run ?? '');
  return mutantsFor(runs, crate, 'the nightly');
}

// GitHub expressions are written `${{ ... }}`; compare the inside, with its spaces collapsed.
function expression(text: string | undefined): string {
  return (text ?? '')
    .replace(/^\$\{\{\s*/u, '')
    .replace(/\s*\}\}$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function jobOf(workflow: Workflow, name: string): Workflow['jobs'][string] {
  const job = workflow.jobs[name];
  if (job === undefined) throw new Error(`the workflow has no job "${name}"`);
  return job;
}

function downloadStep(workflow: Workflow): WorkflowStep {
  const steps = jobOf(workflow, 'quality').steps ?? [];
  const found = steps.find((step) => String(step.uses ?? '').startsWith('actions/download-artifact@'));
  if (found === undefined) throw new Error('the quality job has no download-artifact step');
  return found;
}

// The text of a section, from its heading line up to the next line that starts with `stop`.
function between(text: string, start: string, stop: string): string {
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`no text starts with "${start}"`);
  const to = text.indexOf(stop, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
}

When('the contributor asks turbo for the plan of the acceptance run', ({ scenario }) => {
  const world = harness(scenario);
  const run = shell(scenario.repoRoot, 'pnpm exec turbo run test:acceptance --dry=json');
  world.runs.push(run);
  expect(run.status, tail(run)).toBe(0);
  world.plan = (JSON.parse(run.stdout) as { tasks: TurboTask[] }).tasks;
});

Then('the plan runs the site build before the acceptance run', ({ scenario }) => {
  const tasks = harness(scenario).plan;
  if (tasks === undefined) throw new Error('the turbo plan has not been read in this scenario');
  const acceptance = tasks.find((task) => task.taskId === '@d2rmm/acceptance#test:acceptance');
  expect(acceptance, 'the acceptance task in the plan').toBeDefined();
  expect(acceptance?.dependencies ?? [], 'dependencies of the acceptance task').toContain('@d2rmm/web#build');
});

When('the contributor reads the CI workflow', ({ scenario }) => {
  harness(scenario).workflow = readWorkflow(scenario.repoRoot, ciWorkflow);
});

Then(/^the integration job runs "(.+)"$/, ({ scenario }, command: string) => {
  const job = jobOf(requireWorkflow(harness(scenario)), 'integration');
  const runs = (job.steps ?? []).map((step) => step.run);
  expect(runs, 'run steps of the integration job').toContain(command);
});

When("the contributor reads the source of the agent core's mutation metric", ({ scenario }) => {
  const baseline = readJson<{ metrics: Record<string, Metric> }>(
    path.join(scenario.repoRoot, qualityBaseline),
  );
  harness(scenario).metric = baseline.metrics['mutation.agent.core'];
});

Then('it is the outcomes file inside the directory the nightly writes for the agent core', ({ scenario }) => {
  const metric = requireMetric(harness(scenario));
  const output = flagValue(
    nightlyMutants(readWorkflow(scenario.repoRoot, nightlyWorkflow), 'core'),
    '--output',
  );
  if (output === undefined) throw new Error('the nightly core run has no --output');
  expect(metric.source.path).toBe(path.posix.join(output, 'mutants.out', 'outcomes.json'));
});

Then(
  /^the metric still has direction (\w+), floor (\d+) and tolerance (\d+(?:\.\d+)?)$/,
  ({ scenario }, direction: string, floor: string, tolerance: string) => {
    const metric = requireMetric(harness(scenario));
    expect(metric.direction, 'direction').toBe(direction);
    expect(metric.floor, 'floor').toBe(Number(floor));
    expect(metric.tolerance, 'tolerance').toBe(Number(tolerance));
  },
);

Then('the metric is still enforced in the nightly and phase contexts', ({ scenario }) => {
  expect(requireMetric(harness(scenario)).contexts, 'contexts').toEqual(['nightly', 'phase']);
});

When('the contributor reads the agent mutation command', ({ scenario }) => {
  const pkg = readJson<{ scripts?: Record<string, string> }>(path.join(scenario.repoRoot, 'package.json'));
  const script = pkg.scripts?.['test:mutation:agent'] ?? '';
  harness(scenario).agentCommands = script
    .split('&&')
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
});

function agentCommands(world: HarnessWorld): string[] {
  if (world.agentCommands === undefined) throw new Error('the agent mutation command has not been read');
  return world.agentCommands;
}

Then('it runs the domain, the core and the adapters', ({ scenario }) => {
  const commands = agentCommands(harness(scenario));
  for (const crate of agentCrates) mutantsFor(commands, crate, 'test:mutation:agent');
});

Then('each of them uses unit tests only', ({ scenario }) => {
  const commands = agentCommands(harness(scenario));
  for (const crate of agentCrates) {
    expect(mutantsFor(commands, crate, 'test:mutation:agent'), `${crate} command`).toMatch(/\s--\s+--lib$/u);
  }
});

Then('each of them writes to the report path the nightly uses', ({ scenario }) => {
  const commands = agentCommands(harness(scenario));
  const workflow = readWorkflow(scenario.repoRoot, nightlyWorkflow);
  for (const crate of agentCrates) {
    const ours = flagValue(mutantsFor(commands, crate, 'test:mutation:agent'), '--output');
    const nightly = flagValue(nightlyMutants(workflow, crate), '--output');
    expect(ours, `${crate} --output`).toBe(nightly);
    expect(ours, `${crate} --output`).toBeDefined();
  }
});

When('the contributor reads the nightly workflow', ({ scenario }) => {
  harness(scenario).workflow = readWorkflow(scenario.repoRoot, nightlyWorkflow);
});

Then('the quality job needs the agent mutation job', ({ scenario }) => {
  const needs = jobOf(requireWorkflow(harness(scenario)), 'quality').needs;
  expect(typeof needs === 'string' ? [needs] : (needs ?? []), 'needs of quality').toContain('agent-mutation');
});

Then('the quality job runs unless the workflow was cancelled', ({ scenario }) => {
  const condition = expression(jobOf(requireWorkflow(harness(scenario)), 'quality').if);
  expect(condition, 'if of quality').toBe('!cancelled()');
});

Then(
  "the quality job downloads the agent's reports into the mutation reports directory before the ratchet",
  ({ scenario }) => {
    const steps = jobOf(requireWorkflow(harness(scenario)), 'quality').steps ?? [];
    const download = steps.findIndex((step) =>
      String(step.uses ?? '').startsWith('actions/download-artifact@'),
    );
    const ratchet = steps.findIndex((step) => step.name === 'Quality ratchet (nightly)');
    expect(download, 'download step in quality').toBeGreaterThanOrEqual(0);
    expect(ratchet, 'ratchet step in quality').toBeGreaterThanOrEqual(0);
    expect(download, 'download comes before the ratchet').toBeLessThan(ratchet);
    expect(steps[download]?.with?.['name'], 'artifact name').toBe('agent-mutation');
    expect(steps[download]?.with?.['path'], 'artifact path').toBe('reports/mutation');
  },
);

Then('the download is skipped when the agent mutation job was skipped', ({ scenario }) => {
  const condition = expression(downloadStep(requireWorkflow(harness(scenario))).if);
  expect(condition).toBe("needs.agent-mutation.result != 'skipped'");
});

Then('the download action is pinned by its full commit', ({ scenario }) => {
  const uses = downloadStep(requireWorkflow(harness(scenario))).uses ?? '';
  expect(uses, 'download action').toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/u);
});

Then('a failed download does not fail the quality job', ({ scenario }) => {
  expect(downloadStep(requireWorkflow(harness(scenario)))['continue-on-error']).toBe(true);
});

When('the contributor reads the phase runner instructions', ({ scenario }) => {
  harness(scenario).skill = readText(scenario.repoRoot, phaseSkill);
});

Then('the review reads the phase status and the retry budget of each feature', ({ scenario }) => {
  const review = between(requireSkill(harness(scenario)), '## REVIEW', '\n## ');
  expect(review, 'REVIEW section').toContain('pnpm phase:status');
  expect(review, 'REVIEW section').toContain('node scripts/attempt.mjs status --feature');
});

Then('the review does not run the verification validator', ({ scenario }) => {
  const review = between(requireSkill(harness(scenario)), '## REVIEW', '\n## ');
  expect(review, 'REVIEW section').not.toContain('validate_verification.py');
});

Then('a feature still runs the verification validator before its merge', ({ scenario }) => {
  const verify = between(requireSkill(harness(scenario)), '### 6. Verify', '### 7. Integrate');
  expect(verify, 'Verify step of RUN').toContain('validate_verification.py');
});

Then("the review produces the agent's mutation reports before the phase ratchet", ({ scenario }) => {
  const review = between(requireSkill(harness(scenario)), '## REVIEW', '\n## ');
  const mutation = review.indexOf('pnpm test:mutation:agent');
  const ratchet = review.indexOf('pnpm quality:ratchet --context phase');
  expect(mutation, 'agent mutation command in REVIEW').toBeGreaterThanOrEqual(0);
  expect(ratchet, 'phase ratchet in REVIEW').toBeGreaterThan(mutation);
});

When('the contributor reads the review template and the agent guide', ({ scenario }) => {
  harness(scenario).documents = [reviewTemplate, 'AGENTS.md'].map((file) =>
    readText(scenario.repoRoot, file),
  );
});

Then(/^both name "(.+)"$/, ({ scenario }, command: string) => {
  const documents = harness(scenario).documents;
  expect(documents.length, 'documents read').toBe(2);
  for (const document of documents) expect(document).toContain(command);
});
