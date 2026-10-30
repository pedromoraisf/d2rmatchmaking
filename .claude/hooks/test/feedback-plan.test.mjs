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

test('specs run the TLC validators and the delegation check', () => {
  assert.deepEqual(ids('.specs/features/agent-skeleton/spec.md'), ['prettier', 'validate_spec.py', 'acceptance-check', 'specs-check']);
  assert.deepEqual(ids('.specs/features/agent-skeleton/acceptance.feature'), ['acceptance-check', 'specs-check']);
  assert.deepEqual(ids('.specs/features/agent-skeleton/tasks.md'), ['prettier', 'validate_tasks.py', 'specs-check']);
});

test('harness scripts run their own tests; vendored files are never reformatted', () => {
  assert.ok(ids('.claude/hooks/lib/gate-rules.mjs').includes('harness-tests'));
  assert.deepEqual(ids('.claude/skills/tlc-spec-driven/SKILL.md'), []);
  assert.deepEqual(ids('apps/agent/src-tauri/src/main.rs'), ['rustfmt']);
});

test('reminders flag contract, migration and agent-safety concerns', () => {
  assert.match(reminders('packages/contracts/src/lobby.ts')[0], /contracts:openapi/);
  assert.match(reminders('apps/api/migrations/0003_x.sql')[0], /backward compatible/);
  assert.match(reminders('apps/agent/src-tauri/src/capture.rs')[0], /read-only/);
  assert.deepEqual(reminders('README.md'), []);
});
