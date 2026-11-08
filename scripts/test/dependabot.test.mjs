// CFP-20, CFP-21, CFP-22 (ci-fast-path): majors of the eslint and OpenTelemetry families are grouped before dev-tooling
// and held for 30 days; the schedule and the other groups are unchanged. Dependabot assigns an update to the first group
// that matches it, so the first-match rule is modelled here to prove where an eslint major lands.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = parse(readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8'));
const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm');
const groups = npm.groups;
const groupNames = Object.keys(groups);

/** A glob with `*` as the only wildcard, anchored at both ends. */
function globMatches(pattern, name) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'u').test(name);
}

const anyMatch = (patterns, name) => (patterns ?? []).some((pattern) => globMatches(pattern, name));

/** The first group, in file order, that takes the update, as Dependabot assigns it. */
function firstGroupFor(update) {
  for (const [name, group] of Object.entries(groups)) {
    // A group without patterns takes every update its other keys allow; dev-tooling is one of them.
    if (group.patterns !== undefined && !anyMatch(group.patterns, update.name)) {
      continue;
    }
    if (anyMatch(group['exclude-patterns'], update.name)) {
      continue;
    }
    if (group['dependency-type'] !== undefined && group['dependency-type'] !== update.dependencyType) {
      continue;
    }
    if (group['update-types'] !== undefined && !group['update-types'].includes(update.type)) {
      continue;
    }
    return name;
  }
  return undefined;
}

test('groups majors of the lint and telemetry families', () => {
  const eslint = groups['eslint-majors'];
  const telemetry = groups['opentelemetry-majors'];
  assert.ok(eslint, 'an eslint group exists');
  assert.ok(telemetry, 'an OpenTelemetry group exists');
  assert.deepEqual(eslint['update-types'], ['major'], 'the eslint group takes majors');
  assert.deepEqual(telemetry['update-types'], ['major'], 'the OpenTelemetry group takes majors');
  assert.deepEqual(eslint.patterns, ['eslint', 'eslint-*', '@eslint/*', 'typescript-eslint']);
  assert.deepEqual(telemetry.patterns, ['@opentelemetry/*']);
  assert.ok(
    groupNames.indexOf('eslint-majors') < groupNames.indexOf('dev-tooling') &&
      groupNames.indexOf('opentelemetry-majors') < groupNames.indexOf('dev-tooling'),
    'both groups are listed before dev-tooling',
  );
});

test('an eslint major lands in its group, not in dev-tooling', () => {
  const major = { name: 'eslint', type: 'major', dependencyType: 'development' };
  assert.equal(
    firstGroupFor(major),
    'eslint-majors',
    'the eslint major takes the eslint group by first match',
  );
  assert.equal(
    firstGroupFor({ name: '@eslint/js', type: 'major', dependencyType: 'development' }),
    'eslint-majors',
    'an @eslint/* major takes the eslint group',
  );
  assert.equal(
    firstGroupFor({ name: '@opentelemetry/api', type: 'major', dependencyType: 'production' }),
    'opentelemetry-majors',
    'an OpenTelemetry major takes its group',
  );
  assert.equal(
    firstGroupFor({ name: 'eslint', type: 'minor', dependencyType: 'development' }),
    'dev-tooling',
    'an eslint minor still takes dev-tooling, as before',
  );
});

test('holds those majors for 30 days', () => {
  assert.equal(npm.cooldown['semver-major-days'], 30, 'semver-major updates wait 30 days');
  const included = npm.cooldown.include;
  for (const name of [
    'eslint',
    'eslint-plugin-react',
    '@eslint/js',
    'typescript-eslint',
    '@opentelemetry/api',
  ]) {
    assert.ok(anyMatch(included, name), `${name} is held`);
  }
  assert.ok(!anyMatch(included, 'react'), 'other packages are not held by this cooldown');
});

test('keeps the weekly schedule and the old groups', () => {
  assert.deepEqual(npm.schedule, { interval: 'weekly' }, 'the npm schedule stays weekly');
  assert.deepEqual(groups.playwright.patterns, ['@playwright/test', 'playwright', 'playwright-bdd']);
  assert.deepEqual(groups['dev-tooling'], {
    'dependency-type': 'development',
    'exclude-patterns': ['@playwright/test', 'playwright', 'playwright-bdd'],
  });
  assert.deepEqual(groupNames, ['playwright', 'eslint-majors', 'opentelemetry-majors', 'dev-tooling']);
  const actions = config.updates.find((update) => update['package-ecosystem'] === 'github-actions');
  assert.deepEqual(actions.schedule, { interval: 'weekly' }, 'the Actions schedule stays weekly');
});
