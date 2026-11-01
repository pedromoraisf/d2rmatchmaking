// Static checks of the CI `agent` job (AGS-02, AGS-21, AGS-22). The job runs on windows-latest; its first run on the
// maintainer's PR is the phase review's proof (C3). Here its steps, order, pins and fixtures are checked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
const job = ci.jobs.agent;
const steps = job.steps;
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

// Every command line of the job's run steps, in order.
const commands = steps.flatMap((step) =>
  typeof step.run === 'string'
    ? step.run
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [],
);
const indexOfCommand = (line) => commands.indexOf(line);

test('the agent job runs fmt, clippy, nextest, deny and the fixtures', () => {
  const ordered = [
    'cargo fmt --all -- --check',
    'cargo clippy --locked --all-targets -- -D warnings',
    'cargo clippy --locked --all-targets --all-features -- -D warnings',
    'cargo nextest run --locked',
    'cargo nextest run --locked --all-features',
    'cargo deny --locked check',
  ];
  const indexes = ordered.map(indexOfCommand);
  indexes.forEach((index, position) => assert.notEqual(index, -1, `${ordered[position]} is a run step`));
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
    'the steps run in the listed order',
  );

  const fixtures = commands.filter((line) => line.startsWith('node scripts/agent/expect-failure.mjs '));
  assert.ok(
    fixtures.every((line) => line.includes(' -- cargo ')),
    'every fixture runs a cargo command through expect-failure',
  );
  const cargoLines = commands.filter((line) => line.startsWith('cargo ') && !line.startsWith('cargo fmt'));
  assert.ok(
    cargoLines.every((line) => line.includes('--locked')),
    'every cargo command passes --locked',
  );
  assert.ok(
    indexOfCommand('cargo deny --locked check') > indexOfCommand('cargo nextest run --locked --all-features'),
    'deny runs after the tests',
  );
  assert.ok(
    commands.indexOf(fixtures[0]) > indexOfCommand('cargo deny --locked check'),
    'the fixtures run after deny',
  );
});

test('the agent job runs the five boundary fixtures by rule id', () => {
  const ids = ['banned', 'unsafe_code', 'disallowed_types', 'disallowed_methods', 'disallowed_types'];
  const fixtures = commands.filter((line) => line.startsWith('node scripts/agent/expect-failure.mjs '));
  assert.deepEqual(
    fixtures.map((line) => line.split(' ')[2]),
    ids,
    'the five fixture ids run in order: banned, unsafe_code, disallowed_types, disallowed_methods, disallowed_types',
  );
  assert.ok(
    fixtures.some(
      (line) =>
        line.includes('boundary-fixtures/toolhelp-read/') && line.includes('--target x86_64-pc-windows-msvc'),
    ),
    'toolhelp-read is checked with the Windows target',
  );
});

test('domain clock fixture runs through expect-failure with its lint id', () => {
  const line = commands.find((command) => command.includes('boundary-fixtures/domain-clock/'));
  assert.ok(line, 'the domain-clock fixture is a run step');
  assert.equal(
    line,
    'node scripts/agent/expect-failure.mjs disallowed_types -- cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/domain-clock/Cargo.toml -- -D warnings',
    'domain-clock fails with disallowed_types through expect-failure, with the domain clippy policy',
  );
});

test('the agent job builds the UI and the Rust steps follow it on Windows', () => {
  assert.equal(job['runs-on'], 'windows-latest');
  const build = steps.findIndex((step) => step.run === 'pnpm --filter @d2rmm/agent build');
  const fmt = steps.findIndex((step) => step.run === 'cargo fmt --all -- --check');
  assert.notEqual(build, -1, 'the UI build step exists');
  assert.ok(build < fmt, 'the UI builds before any Rust step (Tauri reads frontendDist)');
});

test('the agent job pins every action by a full commit SHA and pins the tools it installs', () => {
  const uses = steps.filter((step) => step.uses).map((step) => step.uses);
  assert.ok(uses.length > 0, 'the job uses actions');
  for (const reference of uses) {
    assert.match(reference, SHA_PINNED, `${reference} is pinned by a 40-char SHA`);
  }
  const install = steps.find((step) => step.uses?.startsWith('taiki-e/install-action@'));
  assert.deepEqual(
    install.with.tool.split(',').sort(),
    ['cargo-deny@0.20.2', 'cargo-nextest@0.9.150'],
    'cargo-nextest and cargo-deny are installed at pinned versions',
  );
});
