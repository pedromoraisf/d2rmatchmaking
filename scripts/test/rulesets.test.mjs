// CFP-13, CFP-14 (ci-fast-path): the ruleset of main requires the four checks that guard it, and none of the parallel jobs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruleset = JSON.parse(readFileSync(path.join(root, '.github', 'rulesets', 'main.json'), 'utf8'));
const requiredContexts = () =>
  ruleset.rules
    .find((rule) => rule.type === 'required_status_checks')
    .parameters.required_status_checks.map((check) => check.context);

// CFP-13: the required checks are exactly these four (ADR 028 § 2).
test('main requires verify, integration, agent and secrets', () => {
  assert.deepEqual([...requiredContexts()].sort(), ['agent', 'integration', 'secrets', 'verify']);
});

// CFP-14: the parallel jobs run beside the required checks and are not required.
test('the parallel jobs are not required', () => {
  const required = requiredContexts();
  for (const job of ['mutation', 'agent-mutation', 'smoke', 'agent-build']) {
    assert.ok(!required.includes(job), `${job} is not a required check`);
  }
});
