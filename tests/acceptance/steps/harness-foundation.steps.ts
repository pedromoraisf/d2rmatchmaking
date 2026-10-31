// Acceptance steps for harness-foundation (ADR 023), one step per line of acceptance.feature. Black box: each step
// runs a repository command or the architecture sensor in a child process, or reads a file, and asserts on the exit
// code, the output or the file. Nothing here imports apps/ or packages/ (rule acceptance-is-black-box).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
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

// The state this feature's steps share within one scenario, stored in the scenario fixture.
interface HarnessWorld {
  runs: CommandRun[];
  workspaces: string[];
  tsconfigs: string[];
  fixture: string | undefined;
  check: ArchitectureCheck | undefined;
  baseline: Baseline | undefined;
  release: Release | undefined;
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
