import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFeedback, reminders } from '../lib/feedback-plan.mjs';

const all = () => true;
const none = () => false;
const ids = (rel, has = all) => planFeedback(rel, has).map((s) => s.id);

test('domain TypeScript gets format, lint, architecture and related tests', () => {
  assert.deepEqual(ids('apps/api/src/modules/ranking/domain/rating.ts'), [
    'prettier',
    'eslint',
    'dependency-cruiser',
    'vitest-related',
  ]);
});

test('missing tools are skipped, not failed', () => {
  assert.deepEqual(ids('apps/api/src/modules/ranking/domain/rating.ts', none), []);
});

test('specs run the acceptance and specs checks', () => {
  assert.deepEqual(ids('.specs/features/agent-skeleton/spec.md'), [
    'prettier',
    'acceptance-check',
    'specs-check',
  ]);
  assert.deepEqual(ids('.specs/features/agent-skeleton/acceptance.feature'), [
    'acceptance-check',
    'specs-check',
  ]);
  assert.deepEqual(ids('.specs/features/agent-skeleton/tasks.md'), ['prettier', 'specs-check']);
});

test('harness scripts run their own test only; vendored files are never reformatted', () => {
  const step = planFeedback('.claude/hooks/lib/gate-rules.mjs', all).find((s) => s.id === 'harness-tests');
  assert.deepEqual(step.args, ['--test', '.claude/hooks/test/gate-rules.test.mjs']);
  const lib = planFeedback('scripts/lib/ratchet.mjs', all).find((s) => s.id === 'harness-tests');
  assert.deepEqual(lib.args, ['--test', 'scripts/test/ratchet.test.mjs']);
  const missing = planFeedback('scripts/lib/no-test.mjs', all, () => false).map((s) => s.id);
  assert.ok(!missing.includes('harness-tests'));
  assert.deepEqual(ids('.claude/skills/tlc-spec-driven/SKILL.md'), []);
  assert.deepEqual(ids('apps/agent/src-tauri/src/main.rs'), ['rustfmt']);
});

test('reminders flag contract, migration and agent-safety concerns', () => {
  assert.match(reminders('packages/contracts/src/lobby.ts')[0], /contracts:openapi/);
  assert.match(reminders('apps/api/migrations/0003_x.sql')[0], /backward compatible/);
  assert.match(reminders('apps/agent/src-tauri/src/capture.rs')[0], /read-only/);
  assert.deepEqual(reminders('README.md'), []);
});
