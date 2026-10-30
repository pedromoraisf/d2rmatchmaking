import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBash, checkEdit, decide } from '../lib/gate-rules.mjs';
import { toRelative } from '../lib/io.mjs';

function fakeCtx(files = {}, { tracked = [], branch = 'feat/x' } = {}) {
  return {
    root: '/repo',
    readFile: (rel) => (rel in files ? files[rel] : null),
    isTracked: (rel) => tracked.includes(rel),
    currentBranch: () => branch,
    git: () => '',
  };
}
const d = (r) => r?.decision ?? 'allow';

const BRIEF_APPROVED = [
  '# F0 brief',
  '## Delegation',
  '- [x] specs-and-tasks: approve specs and tasks that pass the automatic gates',
  '- [x] sub-agents: dispatch workers',
  '- [ ] harness-edits: edit harness files',
  '',
  '**Approved**: 2026-11-02 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos"',
].join('\n');

test('bash: safe everyday commands pass', () => {
  const ctx = fakeCtx();
  for (const c of [
    'pnpm test',
    'git status',
    'git commit -m "feat: x"',
    'rm -rf node_modules dist',
    'rm -rf apps/api/coverage',
    'node --test',
  ]) {
    assert.equal(d(checkBash(c, ctx)), 'allow', c);
  }
});

test('bash: destructive and bypass commands are denied', () => {
  const ctx = fakeCtx();
  for (const c of [
    'git push --force origin main',
    'git push -f',
    'git push origin +main',
    'git reset --hard HEAD~1',
    'git commit --no-verify -m x',
    'LEFTHOOK=0 git commit -m x',
    'rm -rf /',
    'rm -rf src',
    'rm -fr apps/api',
    'cat .env',
    'psql "postgres://u:p@ep-x.neon.tech/db"', // secretlint-disable-line -- fake fixture for the gate test
    'echo $NEON_DATABASE_URL',
    'sed -i s/80/10/ .quality-baseline.json',
  ]) {
    assert.equal(d(checkBash(c, ctx)), 'deny', c);
  }
});

test('bash: escalations ask the maintainer', () => {
  const ctx = fakeCtx();
  for (const c of [
    'git push origin phase/F0',
    'gh pr merge 12 --squash',
    'gh secret set RENDER_DEPLOY_HOOK',
    'npx wrangler pages deploy dist',
    'curl -X POST https://api.render.com/deploy/srv-1?key=x', // secretlint-disable-line -- fake fixture for the gate test
    'git rm apps/api/src/x.test.ts',
    'pnpm publish',
    'git tag agent-v0.0.1',
  ]) {
    assert.equal(d(checkBash(c, ctx)), 'ask', c);
  }
  assert.equal(d(checkBash('git merge feat/x', fakeCtx({}, { branch: 'main' }))), 'ask');
  assert.equal(d(checkBash('git merge feat/x', fakeCtx({}, { branch: 'phase/F0' }))), 'allow');
});

test('edit: secrets, vendored skill and applied migrations are denied', () => {
  const ctx = fakeCtx({}, { tracked: ['apps/api/migrations/0001_init.sql'] });
  assert.equal(d(checkEdit('.env', { content: 'X=1' }, ctx)), 'deny');
  assert.equal(d(checkEdit('apps/api/.env.local', { content: 'X=1' }, ctx)), 'deny');
  assert.equal(d(checkEdit('.env.example', { content: 'X=' }, ctx)), 'allow');
  assert.equal(d(checkEdit('.claude/skills/tlc-spec-driven/SKILL.md', { content: '' }, ctx)), 'deny');
  assert.equal(d(checkEdit('apps/api/migrations/0001_init.sql', { content: '' }, ctx)), 'deny');
  assert.equal(d(checkEdit('apps/api/migrations/0002_next.sql', { content: '' }, ctx)), 'allow');
  assert.equal(d(checkEdit('../outside.txt', { content: '' }, ctx)), 'deny');
});

test('edit: the quality baseline only tightens', () => {
  const base = { metrics: { 'mutation.api.domain': { value: 82, direction: 'higher', floor: 80 } } };
  const ctx = fakeCtx({ '.quality-baseline.json': JSON.stringify(base) });
  const tighter = { metrics: { 'mutation.api.domain': { value: 85, direction: 'higher', floor: 80 } } };
  const looser = { metrics: { 'mutation.api.domain': { value: 82, direction: 'higher', floor: 70 } } };
  assert.equal(d(checkEdit('.quality-baseline.json', { content: JSON.stringify(tighter) }, ctx)), 'allow');
  assert.equal(d(checkEdit('.quality-baseline.json', { content: JSON.stringify(looser) }, ctx)), 'deny');
  assert.equal(d(checkEdit('.quality-baseline.json', { content: '{"metrics":{}}' }, ctx)), 'deny');
  assert.equal(d(checkEdit('.quality-baseline.json', { content: 'not json' }, ctx)), 'deny');
});

test('edit: weakening tests escalates, .only is denied', () => {
  const before = "test('a', () => {});\ntest('b', () => {});\n";
  const ctx = fakeCtx({ 'apps/api/src/x.test.ts': before });
  const rel = 'apps/api/src/x.test.ts';
  assert.equal(d(checkEdit(rel, { old_string: "test('b', () => {});\n", new_string: '' }, ctx)), 'ask');
  assert.equal(d(checkEdit(rel, { old_string: "test('b'", new_string: "test.skip('b'" }, ctx)), 'ask');
  assert.equal(d(checkEdit(rel, { old_string: "test('b'", new_string: "test.only('b'" }, ctx)), 'deny');
  assert.equal(d(checkEdit(rel, { content: `${before}test('c', () => {});\n` }, ctx)), 'allow');
});

test('edit: approvals — only delegated, verbatim, cited', () => {
  const words = 'aprovo specs e tasks da F0 que passarem nos gates automáticos';
  const files = { '.specs/phases/ACTIVE': 'F0\n', '.specs/phases/F0/brief.md': BRIEF_APPROVED };
  const ctx = fakeCtx(files);
  const rel = '.specs/features/harness-foundation/spec.md';
  const good = `**Approved**: 2026-11-03 - user: "${words}" (delegated via .specs/phases/F0/brief.md)`;
  assert.equal(d(checkEdit(rel, { content: `# Spec\n${good}\n` }, ctx)), 'allow');
  assert.equal(
    d(checkEdit(rel, { content: '# Spec\n**Approved**: 2026-11-03 - user: "looks good"\n' }, ctx)),
    'deny',
  );
  assert.equal(
    d(checkEdit(rel, { content: `# Spec\n**Approved**: 2026-11-03 - user: "${words}"\n` }, ctx)),
    'deny',
  );
  // No active phase → ask the human.
  assert.equal(d(checkEdit(rel, { content: `# Spec\n${good}\n` }, fakeCtx())), 'ask');
  // Brief without approval → ask.
  const unapproved = {
    ...files,
    '.specs/phases/F0/brief.md': BRIEF_APPROVED.replace(/\*\*Approved.*$/m, ''),
  };
  assert.equal(d(checkEdit(rel, { content: `# Spec\n${good}\n` }, fakeCtx(unapproved))), 'ask');
  // Writing the brief approval itself always asks.
  assert.equal(d(checkEdit('.specs/phases/F0/brief.md', { content: BRIEF_APPROVED }, fakeCtx())), 'ask');
});

test('edit: accepted ADRs and harness files escalate unless delegated', () => {
  const adr = '# ADR 002\n\n**Status**: Accepted\n';
  const ctx = fakeCtx({ 'docs/adr/002-modular-monolith.md': adr });
  assert.equal(d(checkEdit('docs/adr/002-modular-monolith.md', { content: `${adr}x` }, ctx)), 'ask');
  assert.equal(d(checkEdit('docs/adr/022-new.md', { content: '# new' }, ctx)), 'allow');
  assert.equal(d(checkEdit('lefthook.yml', { content: 'x' }, ctx)), 'ask');
  const delegated = fakeCtx({
    '.specs/phases/ACTIVE': 'F0',
    '.specs/phases/F0/brief.md': BRIEF_APPROVED.replace('- [ ] harness-edits', '- [x] harness-edits'),
  });
  assert.equal(d(checkEdit('lefthook.yml', { content: 'x' }, delegated)), 'allow');
  // The gate protects itself even under delegation.
  assert.equal(d(checkEdit('.claude/hooks/gate.mjs', { content: 'x' }, delegated)), 'ask');
  assert.equal(d(checkEdit('.claude/settings.json', { content: '{}' }, delegated)), 'ask');
});

test('decide: routes tools and blocks reading secrets', () => {
  const ctx = fakeCtx();
  assert.equal(
    d(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/.env' } }, ctx, toRelative)),
    'deny',
  );
  assert.equal(
    d(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/README.md' } }, ctx, toRelative)),
    'allow',
  );
  assert.equal(
    d(decide({ tool_name: 'Write', tool_input: { file_path: '/repo/.env', content: '' } }, ctx, toRelative)),
    'deny',
  );
  assert.equal(d(decide({ tool_name: 'WebSearch', tool_input: {} }, ctx, toRelative)), 'allow');
});

test('approval examples inside HTML comments never count', async () => {
  const { approvalsIn, activePhase } = await import('../lib/delegation.mjs');
  const brief = '## Approval\n\n<!-- example:\n**Approved**: 2026-11-02 - user: "aprovo"\n-->\n';
  assert.deepEqual(approvalsIn(brief), []);
  const ctx = fakeCtx({ '.specs/phases/ACTIVE': 'F0', '.specs/phases/F0/brief.md': brief });
  assert.equal(activePhase(ctx).approved, false);
});

test('acceptance scenarios: never focused, skipped, removed or in another language without the maintainer', () => {
  const rel = '.specs/features/api-web-skeleton/acceptance.feature';
  const before =
    'Feature: x\n\n  @ROOM-01\n  Scenario: a\n    When b\n    Then c\n\n  @ROOM-02\n  Scenario: d\n    When e\n    Then f\n';
  const ctx = fakeCtx({ [rel]: before });
  assert.equal(d(checkEdit(rel, { content: before.replace('@ROOM-01', '@ROOM-01 @only') }, ctx)), 'deny');
  assert.equal(d(checkEdit(rel, { content: `# language: pt\n${before}` }, ctx)), 'deny');
  assert.equal(d(checkEdit(rel, { content: before.replace('@ROOM-02', '@ROOM-02 @skip') }, ctx)), 'ask');
  assert.equal(d(checkEdit(rel, { content: before.slice(0, before.indexOf('  @ROOM-02')) }, ctx)), 'ask');
  assert.equal(
    d(checkEdit(rel, { content: `${before}  # not-scenario: ROOM-03 — load test\n` }, ctx)),
    'ask',
  );
  assert.equal(
    d(checkEdit(rel, { content: `${before}\n  @ROOM-03\n  Scenario: g\n    When h\n    Then i\n` }, ctx)),
    'allow',
  );
  assert.equal(d(checkEdit('tests/acceptance/playwright.config.ts', { content: 'retries: 2' }, ctx)), 'ask');
});

test('the committed retry-ledger snapshot cannot be edited by agents', () => {
  assert.equal(d(checkEdit('.specs/phases/F0/attempts.json', { content: '{}' }, fakeCtx())), 'deny');
  assert.equal(d(checkEdit('scripts/lib/phase-state.mjs', { content: 'x' }, fakeCtx())), 'ask');
});
