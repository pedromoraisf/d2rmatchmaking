// Proves the telemetry rules of .dependency-cruiser.cjs (OBS-22, OBS-41): an application file never imports the telemetry
// SDK entries or an OpenTelemetry SDK package, and the root entry of packages/telemetry imports no SDK package.
// Each fixture folder is scanned with itself as the working directory (like arch-fixtures.test.mjs). The real telemetry
// tree is checked too, so a root file that starts importing an SDK fails here as well as in pnpm arch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const config = path.join(root, '.dependency-cruiser.cjs');
const depcruise = path.join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
const fixtures = path.join(here, 'fixtures', 'arch-telemetry');
const telemetrySrc = 'packages/telemetry/src';

// The root entry (design § Telemetry package > Enforcement): every top-level file except the two SDK entries.
const ROOT_FILES = [
  'attributes.ts',
  'index.ts',
  'instrument-names.ts',
  'redact-attributes.ts',
  'trace-context.ts',
];
const SDK_ENTRY_FILES = ['node-sdk.ts', 'web-sdk.ts'];

function depcruiseIn(cwd, targets, outputType) {
  return spawnSync(
    process.execPath,
    [depcruise, '--config', config, '--output-type', outputType, ...targets],
    { cwd, encoding: 'utf8' },
  );
}

// The exit code comes from the `err` reporter; the rule names come from the `json` reporter (see arch-fixtures.test.mjs).
function cruise(cwd, targets) {
  const status = depcruiseIn(cwd, targets, 'err').status;
  const report = JSON.parse(depcruiseIn(cwd, targets, 'json').stdout);
  return { status, report };
}

function errorRules(report) {
  const names = report.summary.violations.filter((v) => v.rule.severity === 'error').map((v) => v.rule.name);
  return [...new Set(names)].sort();
}

// The SDK packages are installed only in the real tree, so a fixture that imports one gets a stub of that package in its
// own node_modules. node_modules is git-ignored, so the stub is written on each run and never committed.
function writeStub(caseDir, packageName) {
  const dir = path.join(caseDir, 'node_modules', ...packageName.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: packageName, version: '0.0.0', type: 'module', main: 'index.js' }),
  );
  writeFileSync(path.join(dir, 'index.js'), 'export const stub = undefined;\n');
}

test('an application file importing the telemetry node entry fails', () => {
  const { status, report } = cruise(path.join(fixtures, 'application-imports-telemetry-node'), [
    'apps',
    'packages',
  ]);
  assert.notEqual(status, 0, 'the application file must fail the architecture check');
  assert.deepEqual(errorRules(report), ['application-no-adapters']);
});

test('an application file importing an OpenTelemetry resources package fails', () => {
  const caseDir = path.join(fixtures, 'application-imports-otel-resources');
  writeStub(caseDir, '@opentelemetry/resources');
  const { status, report } = cruise(caseDir, ['apps']);
  assert.notEqual(status, 0, 'the application file must fail the architecture check');
  assert.deepEqual(errorRules(report), ['application-no-adapters']);
});

test('the telemetry root files import no sdk package', () => {
  const caseDir = path.join(fixtures, 'root-imports-sdk');
  writeStub(caseDir, '@opentelemetry/sdk-trace-base');
  const fixture = cruise(caseDir, ['packages']);
  assert.notEqual(fixture.status, 0, 'a root file importing an SDK package must fail the architecture check');
  assert.deepEqual(errorRules(fixture.report), ['telemetry-root-has-no-sdk']);

  const real = cruise(root, [telemetrySrc]);
  assert.deepEqual(
    errorRules(real.report),
    [],
    'the real telemetry tree must pass the rules it is checked against',
  );
});

test('the telemetry root entry lists exactly its files', () => {
  const require = createRequire(import.meta.url);
  const rule = require(config).forbidden.find((r) => r.name === 'telemetry-root-has-no-sdk');
  assert.ok(rule, 'the telemetry-root-has-no-sdk rule must exist');
  const rootPattern = new RegExp(rule.from.path);

  // Every top-level non-test file of the package is either a root file matched by the rule or an SDK entry, and the
  // rule matches exactly the root files named here.
  const candidates = readdirSync(path.join(root, telemetrySrc))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => `${telemetrySrc}/${file}`)
    .sort();
  const matched = candidates.filter((file) => rootPattern.test(file));
  assert.deepEqual(matched, ROOT_FILES.map((file) => `${telemetrySrc}/${file}`).sort());
  const unmatched = candidates.filter((file) => !rootPattern.test(file));
  assert.deepEqual(unmatched, SDK_ENTRY_FILES.map((file) => `${telemetrySrc}/${file}`).sort());

  // The root entry imports only root files, so the rule's per-import check covers everything it re-exports.
  const index = readFileSync(path.join(root, telemetrySrc, 'index.ts'), 'utf8');
  const specifiers = [...index.matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, 'the root entry must re-export its files');
  for (const specifier of specifiers) {
    assert.ok(
      ROOT_FILES.includes(specifier),
      `index.ts re-exports ${specifier}, which is not a listed root file`,
    );
  }
});
