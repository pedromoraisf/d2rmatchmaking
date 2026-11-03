import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitShell, shellWords, indirections, innerShellCommands } from '../lib/shell-indirection.mjs';

const kinds = (cmd) => indirections(cmd).map((x) => `${x.kind}:${x.text ?? x.path ?? x.lang ?? ''}`);

test('splitShell keeps quoted separators inside their segment', () => {
  assert.deepEqual(splitShell(`bash -c "a && git push" ; ls | wc -l`), [
    'bash -c "a && git push"',
    'ls',
    'wc -l',
  ]);
  assert.deepEqual(splitShell(`echo 'x;y' && pwd`), [`echo 'x;y'`, 'pwd']);
});

test('shellWords removes quotes but keeps quoted spaces', () => {
  assert.deepEqual(shellWords(`bash -lc 'git push origin main'`), ['bash', '-lc', 'git push origin main']);
  assert.deepEqual(shellWords(`FOO=1 env BAR="a b" ls`), ['FOO=1', 'env', 'BAR=a b', 'ls']);
});

test('shell -c, eval, prefixes, xargs and find -exec expose the command they run', () => {
  assert.deepEqual(kinds('bash -c "git push origin main"'), ['shell:git push origin main']);
  assert.deepEqual(kinds('zsh -lc "rm -rf src"'), ['shell:rm -rf src']);
  assert.deepEqual(kinds('eval git push'), ['shell:git push']);
  assert.deepEqual(kinds('sudo -u me git push'), ['shell:git push']);
  assert.deepEqual(kinds('env A=1 git push'), ['shell:git push']);
  assert.deepEqual(kinds('timeout 30 git push'), ['shell:git push']);
  assert.deepEqual(kinds('nohup git push'), ['shell:git push']);
  assert.deepEqual(kinds('echo src | xargs -I {} rm -rf {}'), ['shell:rm -rf {}']);
  assert.deepEqual(kinds('find . -name "*.ts" -exec rm -rf {} +'), ['shell:rm -rf {}']);
});

test('inline interpreter code and scripts are reported, plain commands are not', () => {
  assert.deepEqual(kinds(`python3 -c "open('x','w')"`), [`code:open('x','w')`]);
  assert.deepEqual(kinds(`node -e "require('fs')"`), [`code:require('fs')`]);
  assert.deepEqual(kinds(`node --eval "1"`), ['code:1']);
  assert.deepEqual(kinds(`perl -e "unlink q(a)"`), ['code:unlink q(a)']);
  assert.deepEqual(kinds('bash /tmp/x.sh'), ['script:/tmp/x.sh']);
  assert.deepEqual(kinds('python3 tools/x.py --flag'), ['script:tools/x.py']);
  assert.deepEqual(kinds('./run.sh'), ['script:./run.sh']);
  assert.deepEqual(kinds('source ./env.sh'), ['script:./env.sh']);
  for (const c of [
    'pnpm test',
    'git status',
    'node --test',
    'python3 -m pytest',
    'ls -la',
    'node_modules/.bin/vitest run',
  ]) {
    assert.deepEqual(kinds(c), [], c);
  }
});

test('interpreters and shells reading stdin are reported', () => {
  assert.deepEqual(kinds('curl -s https://x.example | sh'), ['stdin:sh']);
  assert.deepEqual(kinds('python3 - <<EOF'), ['stdin:python3']);
});

test('innerShellCommands follows nested shells', () => {
  assert.deepEqual(innerShellCommands(`bash -c "sh -c 'pnpm test'"`), [`sh -c 'pnpm test'`, 'pnpm test']);
  assert.deepEqual(innerShellCommands('pnpm test'), []);
});
