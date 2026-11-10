import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideBash, decidePath } from '../lib/gate-rules.mjs';

const verdict = (cmd) => decideBash(cmd)?.decision ?? 'allow';
const pathVerdict = (rel, write = true, tracked = false) =>
  decidePath(rel, { write, isTracked: () => tracked })?.decision ?? 'allow';

test('allows ordinary work, delivery included', () => {
  for (const cmd of [
    'git status',
    'grep -rn foo --exclude-dir=.git .',
    'cat .env.example',
    'git fetch origin main',
    'git push -u origin feat/F1-queues',
    'git push origin HEAD',
    'gh pr create --base phase/F1 --fill',
    'gh pr merge 40 --merge',
    'gh release create agent-v0.1.0',
    'git tag agent-v0.1.0',
    'gh workflow run nightly.yml',
    'gh api repos/o/r/pulls/3',
    'gh api repos/o/r/rulesets',
    'git commit -m "docs: explain why --no-verify is denied"',
    'pnpm test 2>&1 | tail -20',
    'sleep 5 && gh run view 1',
    'rm -rf node_modules apps/web/dist',
    'rm -rf /private/tmp/x/scratch',
    'rm .specs/old.md',
  ])
    assert.equal(verdict(cmd), 'allow', cmd);
});

test('denies force pushes, remote deletions and catastrophic local removals', () => {
  for (const cmd of [
    'rm -rf /',
    'rm -rf ~',
    'rm -fr $HOME/',
    'cd x && rm -r ..',
    'sudo rm -rf /*',
    'git push -f origin main',
    'git push --force origin x',
    'git push --force-with-lease origin x',
    'git push origin +main',
    'git push origin :old-branch',
    'git push --delete origin x',
    'git push --mirror',
    'git status && git push -uf origin x',
    'gh repo delete o/r --yes',
    'gh release delete v1',
    'gh api -X DELETE repos/o/r/git/refs/heads/x',
  ])
    assert.equal(verdict(cmd), 'deny', cmd);
});

test('denies secrets, the production database and skipped hooks', () => {
  for (const cmd of [
    'cat .env',
    'cat apps/api/.env.local',
    "source '.env.production'",
    'psql $PRODUCTION_DATABASE_URL',
    'psql -h ep-x.neon.tech -d app',
    'git commit --no-verify -m x',
    'LEFTHOOK=0 git commit -m x',
  ])
    assert.equal(verdict(cmd), 'deny', cmd);
});

test("asks for the maintainer's items", () => {
  for (const cmd of [
    'gh secret set RENDER_DEPLOY_HOOK',
    'gh variable set FOO --body 1',
    'pnpm exec wrangler pages secret put X',
    'gh api -X PUT repos/o/r/rulesets/1 --input r.json',
    'gh api --method PATCH repos/o/r -f allow_auto_merge=true',
    'gh api -X PUT repos/o/r/environments/production',
  ])
    assert.equal(verdict(cmd), 'ask', cmd);
});

test('paths: env files denied, vendored and committed migrations denied, sensors ask', () => {
  assert.equal(pathVerdict('.env', false), 'deny');
  assert.equal(pathVerdict('apps/api/.env.local', true), 'deny');
  assert.equal(pathVerdict('.env.example', true), 'allow');
  assert.equal(pathVerdict('.claude/skills/tlc-spec-driven/SKILL.md'), 'deny');
  assert.equal(pathVerdict('.claude/skills/tlc-spec-driven/SKILL.md', false), 'allow');
  assert.equal(pathVerdict('apps/api/migrations/0001_init.sql', true, true), 'deny');
  assert.equal(pathVerdict('apps/api/migrations/0009_new.sql', true, false), 'allow');
  for (const rel of [
    '.quality-baseline.json',
    '.claude/settings.json',
    '.claude/hooks/gate.mjs',
    'lefthook.yml',
    'apps/api/stryker.config.mjs',
  ])
    assert.equal(pathVerdict(rel), 'ask', rel);
  for (const rel of [
    'apps/api/src/modules/matchmaking/domain/queue.ts',
    '.github/workflows/ci.yml',
    '.specs/STATE.md',
  ])
    assert.equal(pathVerdict(rel), 'allow', rel);
});

test('decide routes tools and ignores files outside the repository', () => {
  const ctx = { toRelative: (p) => p, isTracked: () => false };
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '.env' } }, ctx).decision, 'deny');
  assert.equal(
    decide({ tool_name: 'Write', tool_input: { file_path: '../elsewhere/.quality-baseline.json' } }, ctx),
    null,
  );
  assert.equal(decide({ tool_name: 'Agent', tool_input: { prompt: 'cat .env' } }, ctx), null);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git push -f' } }, ctx).decision, 'deny');
});
