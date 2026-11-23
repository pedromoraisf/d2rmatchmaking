import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

// The nightly runs cargo-mutants once per matrix entry (NGT-01). Each entry's command is the job's one template with
// the entry's values filled in, so the checks below read the commands the nightly really runs, one per crate or shard.
const workflow = parse(readFileSync('.github/workflows/nightly.yml', 'utf8'));
const mutationJob = workflow.jobs['agent-mutation'];
const template =
  mutationJob.steps.map((step) => step.run ?? '').find((run) => /cargo mutants\b/.test(run)) ?? '';
const expand = (entry) =>
  template
    .replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => entry[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const nightlyCommands = mutationJob.strategy.matrix.include.map(expand);
const nightly = nightlyCommands.join('\n');
const runLine = nightlyCommands.find((line) => /--package d2rmm-agent-core\b/.test(line)) ?? '';

test('the nightly cargo-mutants run targets the agent core and its unit tests only (ADR 026)', () => {
  assert.match(runLine, /--package d2rmm-agent-core\b/);
  assert.match(runLine, /\s--\s+--lib\s*$/);
  assert.doesNotMatch(runLine, /--workspace|--all-targets|--tests\b/);
});

// AHM-25 / design.md § Mutation scope: the scope names the migrated locations of the old rule modules and all of the domain.
const MUTATION_SCOPE = [
  'domain/src/**/*.rs',
  'core/src/pair.rs',
  'core/src/follow_stream.rs',
  'core/src/check_update.rs',
  'core/src/post_observation.rs',
  'core/src/beat.rs',
  'core/src/party.rs',
  'core/src/screen_reader.rs',
  'adapters/src/http/translate.rs',
  'adapters/src/http/sse.rs',
];

const scopeOf = (toml) => {
  const globs = toml.match(/examine_globs\s*=\s*\[([^\]]*)\]/);
  return globs ? [...globs[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
};

test('mutation rule modules list matches the migrated locations', () => {
  const toml = readFileSync('apps/agent/src-tauri/.cargo/mutants.toml', 'utf8');
  assert.deepEqual(
    MUTATION_SCOPE.filter((path) => !scopeOf(toml).includes(path)),
    [],
    'every migrated rule module is in the scope',
  );

  // A fixture that drops one module must fail the same check.
  const dropsBeat = toml.replace('  "core/src/beat.rs",\n', '');
  assert.deepEqual(
    MUTATION_SCOPE.filter((path) => !scopeOf(dropsBeat).includes(path)),
    ['core/src/beat.rs'],
    'a scope without beat.rs names it as missing',
  );
});

// AHM-23, AHM-24 (ADR 026): the nightly run mutates the domain, the core and the adapters, each against its --lib tests.
const MUTATED_CRATES = ['domain', 'core', 'adapters'];

// Whether the workflow runs cargo-mutants with --lib on every mutated crate.
function coversCratesWithLib(yaml) {
  const runs = yaml.split('\n').filter((line) => /cargo mutants\b/.test(line));
  return MUTATED_CRATES.every((crate) =>
    runs.some(
      (line) => new RegExp(`--package d2rmm-agent-${crate}\\b`).test(line) && /\s--\s+--lib\s*$/.test(line),
    ),
  );
}

test('the nightly mutation run covers the domain core and adapters with --lib', () => {
  assert.equal(coversCratesWithLib(nightly), true);
});

test('a mutation run without the domain or --lib fails', () => {
  const withoutDomain = nightly
    .split('\n')
    .filter((line) => !line.includes('--package d2rmm-agent-domain'))
    .join('\n');
  const withoutLib = nightly.replace(/ -- --lib/g, '');
  assert.equal(coversCratesWithLib(withoutDomain), false, 'a run without the domain fails');
  assert.equal(coversCratesWithLib(withoutLib), false, 'a run without --lib fails');
});

// CRF-09, CRF-10, CRF-11 (ci-and-review-fixes): `pnpm test:mutation:agent` runs the same three crates as the nightly.
const packageScripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const agentCommands = (packageScripts['test:mutation:agent'] ?? '')
  .split('&&')
  .map((command) => command.trim())
  .filter((command) => command.length > 0);
const flagOf = (command, flag) => new RegExp(`(?:^|\\s)${flag}\\s+(\\S+)`).exec(command)?.[1];
const packageOf = (commands, crate) =>
  commands.find(
    (command) =>
      command.startsWith('cargo mutants') && flagOf(command, '--package') === `d2rmm-agent-${crate}`,
  );

test('the agent mutation command covers the three crates', () => {
  for (const crate of MUTATED_CRATES) {
    assert.ok(
      packageOf(agentCommands, crate),
      `test:mutation:agent runs cargo-mutants on d2rmm-agent-${crate}`,
    );
  }
});

test('each agent mutation command uses unit tests only', () => {
  // The mkdir that creates reports/mutation is not a cargo-mutants command; CRF-10 covers the cargo-mutants ones.
  const mutants = agentCommands.filter((command) => command.startsWith('cargo mutants'));
  assert.equal(mutants.length, MUTATED_CRATES.length, 'one cargo-mutants command per crate');
  for (const command of mutants) {
    assert.match(command, /\s--\s+--lib$/u, command);
  }
});

test('each agent mutation command writes where the nightly writes', () => {
  for (const crate of MUTATED_CRATES) {
    const ours = packageOf(agentCommands, crate);
    const theirs = nightlyCommands.find((line) => flagOf(line, '--package') === `d2rmm-agent-${crate}`);
    assert.ok(ours && theirs, `both name d2rmm-agent-${crate}`);
    // A sharded crate writes agent-<crate>-<k> in the nightly; the quality job merges the shards into agent-<crate>.
    assert.equal(
      flagOf(ours, '--output'),
      flagOf(theirs, '--output').replace(/-\d+$/, ''),
      `${crate} --output matches the nightly`,
    );
  }
});

test('the agent mutation command creates the reports directory first', () => {
  const mkdir = agentCommands.findIndex((command) => command === 'mkdir -p reports/mutation');
  const firstMutants = agentCommands.findIndex((command) => command.startsWith('cargo mutants'));
  assert.notEqual(mkdir, -1, 'the command creates reports/mutation');
  assert.notEqual(firstMutants, -1, 'the command runs cargo-mutants');
  assert.ok(mkdir < firstMutants, 'mkdir comes before the first cargo mutants');
});

// The core crate's tests read files outside the crate directory, so cargo-mutants mutates it in place.
test('the agent mutation command mutates the core crate in place, as the nightly does', () => {
  const ours = packageOf(agentCommands, 'core');
  const theirs = nightlyCommands.find((line) => flagOf(line, '--package') === 'd2rmm-agent-core');
  assert.match(ours, /\s--in-place(\s|$)/u, 'test:mutation:agent passes --in-place for core');
  assert.match(theirs, /\s--in-place(\s|$)/u, 'the nightly passes --in-place for core');
});

// The adapters' tests read apps/api/src/modules/agents/config/agent-config.json, outside the copy cargo-mutants makes.
test('the agent mutation command mutates the adapters crate in place, as the nightly does', () => {
  const ours = packageOf(agentCommands, 'adapters');
  const theirs = nightlyCommands.filter((line) => flagOf(line, '--package') === 'd2rmm-agent-adapters');
  assert.match(ours, /\s--in-place(\s|$)/u, 'test:mutation:agent passes --in-place for adapters');
  assert.ok(theirs.length > 0, 'the nightly mutates the adapters');
  for (const line of theirs)
    assert.match(line, /\s--in-place(\s|$)/u, 'the nightly passes --in-place for adapters');
});

// A mutated target/ must never reach the cache: only entries that mutate a copy may save it.
test('the nightly never saves the cache of an --in-place mutation entry', () => {
  const cache = mutationJob.steps.find((step) => String(step.uses ?? '').startsWith('Swatinem/rust-cache'));
  assert.ok(cache, 'the job restores a Rust cache');
  assert.equal(cache.with['save-if'], "${{ matrix.in_place == '' }}");
  for (const entry of mutationJob.strategy.matrix.include)
    assert.equal(
      entry.in_place === '--in-place',
      entry.crate !== 'domain',
      `${entry.name}: in place exactly for core and adapters`,
    );
});

// CRF-27 (ci-and-review-fixes): the shared sampler vector lives in the adapters crate, so cargo-mutants copies it with
// the crate, and the telemetry package keeps no copy.
test('the shared sampler vector lives in the adapters crate', () => {
  assert.equal(existsSync('apps/agent/src-tauri/adapters/test-vectors/sampler.json'), true);
  assert.equal(existsSync('packages/telemetry/test-vectors'), false);
});

// The mutants build with an optimised test profile (ADR 026): the domain's exhaustive tests take seconds each in a debug
// build and every mutant reruns them. The profile keeps the debug assertions and overflow checks on, so a test sees the
// same panics, and `.cargo/mutants.toml` selects it.
test('cargo-mutants builds with the optimised mutants profile', () => {
  const toml = readFileSync('apps/agent/src-tauri/.cargo/mutants.toml', 'utf8');
  const cargo = readFileSync('apps/agent/src-tauri/Cargo.toml', 'utf8');
  const section = cargo.match(/^\[profile\.mutants\]\n((?:(?!\[).*\n?)*)/m)?.[1] ?? '';

  assert.match(toml, /^profile\s*=\s*"mutants"\s*$/m, 'mutants.toml selects the mutants profile');
  assert.match(section, /^inherits\s*=\s*"test"\s*$/m, 'the profile inherits the test profile');
  assert.match(section, /^opt-level\s*=\s*[123]\s*$/m, 'the profile is optimised');
  assert.match(section, /^debug-assertions\s*=\s*true\s*$/m, 'debug assertions stay on');
  assert.match(section, /^overflow-checks\s*=\s*true\s*$/m, 'overflow checks stay on');

  // A config without the line, or a profile that turns the overflow checks off, must fail the same checks.
  assert.doesNotMatch(toml.replace(/^profile\s*=.*$/m, ''), /^profile\s*=\s*"mutants"/m);
  assert.doesNotMatch(
    section.replace('overflow-checks = true', 'overflow-checks = false'),
    /^overflow-checks\s*=\s*true/m,
  );
});

// The profile must not change what the tests observe: a `panic = "abort"` kills the test harness's unwinding, `lto`
// slows every mutant's build, and turning the debug assertions or overflow checks off hides panics a test pins.
const profileSection = (cargo) => cargo.match(/^\[profile\.mutants\]\n((?:(?!\[).*\n?)*)/m)?.[1] ?? '';
const profileViolations = (section) => {
  const found = [];
  const panic = section.match(/^panic\s*=\s*(.+?)\s*(?:#.*)?$/m)?.[1];
  if (panic !== undefined && panic !== '"unwind"') found.push('panic');
  if (/^lto\s*=/m.test(section)) found.push('lto');
  for (const key of ['debug-assertions', 'overflow-checks'])
    if (new RegExp(`^${key}[ \\t]*=[ \\t]*(?!true[ \\t]*(?:#.*)?$)\\S`, 'm').test(section)) found.push(key);
  return found;
};

test('the mutants profile sets no panic, lto or disabled checks', () => {
  const cargo = readFileSync('apps/agent/src-tauri/Cargo.toml', 'utf8');
  const section = profileSection(cargo);
  assert.notEqual(section, '', 'the mutants profile exists');
  assert.deepEqual(profileViolations(section), []);

  // Fixtures that break each rule must be named by the same check.
  assert.deepEqual(profileViolations(`${section}panic = "abort"\n`), ['panic']);
  assert.deepEqual(profileViolations(`${section}panic = "unwind"\n`), []);
  assert.deepEqual(profileViolations(`${section}lto = "thin"\n`), ['lto']);
  assert.deepEqual(profileViolations(`${section}lto = false\n`), ['lto']);
  assert.deepEqual(
    profileViolations(section.replace('debug-assertions = true', 'debug-assertions = false')),
    ['debug-assertions'],
  );
  assert.deepEqual(profileViolations(section.replace('overflow-checks = true', 'overflow-checks = false')), [
    'overflow-checks',
  ]);
});
