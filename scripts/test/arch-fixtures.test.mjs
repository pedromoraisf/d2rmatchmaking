// Proves that each layer rule of .dependency-cruiser.cjs rejects its violation (ADR 004, HF-03).
// Each fixture folder mirrors apps/api/src/... and is scanned with that folder as the working directory, so the
// rules' ^apps/api/src paths match while the real tree (pnpm arch) never sees the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const config = path.join(root, '.dependency-cruiser.cjs');
const depcruise = path.join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
const fixtures = path.join(here, 'fixtures', 'arch');

// The exit code comes from the `err` reporter (exit = number of error violations). The `json` reporter always exits 0,
// so the rule names come from a second run of the same cruise.
function depcruiseIn(caseName, outputType) {
  return spawnSync(process.execPath, [depcruise, '--config', config, '--output-type', outputType, 'apps'], {
    cwd: path.join(fixtures, caseName),
    encoding: 'utf8',
  });
}

function cruise(caseName) {
  const status = depcruiseIn(caseName, 'err').status;
  const report = JSON.parse(depcruiseIn(caseName, 'json').stdout);
  return { status, report };
}

function errorRules(report) {
  const names = report.summary.violations.filter((v) => v.rule.severity === 'error').map((v) => v.rule.name);
  return [...new Set(names)].sort();
}

const violations = [
  ['domain-imports-adapter', 'domain-is-pure', 'a domain file importing an adapter'],
  ['application-imports-adapter', 'application-no-adapters', 'an application file importing an adapter'],
  ['cross-module-internal', 'no-cross-module-internals', "a module importing another module's internal file"],
  ['module-imports-main', 'nobody-imports-main', 'a module file importing the composition root'],
];

for (const [caseName, rule, description] of violations) {
  test(`${rule}: ${description} fails the check with exactly that rule`, () => {
    const { status, report } = cruise(caseName);
    assert.notEqual(status, 0, `${caseName} must fail the architecture check`);
    assert.deepEqual(errorRules(report), [rule]);
  });
}

test('clean: a legal import graph exits 0 with no violation', () => {
  const { status, report } = cruise('clean');
  assert.equal(status, 0);
  assert.deepEqual(report.summary.violations, []);
});
