// Scripts and inline code the gate judges by what they hold (gate-precision, GPR-09, GPR-11 to GPR-13, GPR-32).
// The fake ctx answers files by the names the gate reads them under: repository paths relative to the root, and
// absolute paths for a script outside the checkout. Every answer is a fixture; nothing touches the disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkBash, scriptKind } from '../lib/gate-rules.mjs';
import { indirections } from '../lib/shell-indirection.mjs';

const ROOT = '/repo';
const input = { tool_name: 'Bash', tool_input: {}, cwd: ROOT };
const DIR = { isDirectory: () => true, isFile: () => false, nlink: 1 };
const FILE = { isDirectory: () => false, isFile: () => true, nlink: 1 };
const decisionOf = (r) => r?.decision ?? null;

function fakeCtx(files = {}, { tracked = [] } = {}) {
  const relOf = (p) => (p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : null);
  return {
    root: ROOT,
    mainRoot: ROOT,
    readFile: (p) => (p in files ? files[p] : null),
    isTracked: (rel) => tracked.includes(rel),
    currentBranch: () => 'feat/x',
    git: () => '',
    realpath: (p) => path.resolve(p),
    stat: (p) => {
      if (p === ROOT) return DIR;
      const rel = relOf(p);
      return rel !== null && rel in files ? FILE : null;
    },
  };
}

test('judges a script outside the repository by its content', () => {
  const ctx = fakeCtx({
    '/scratch/look.sh': '#!/bin/sh\nset -e\n# list the checkout\ngit status --short\nls -la\n',
    '/scratch/clean.sh': '#!/bin/sh\nrm -rf apps\n',
    'package.json': '{}',
  });
  assert.equal(scriptKind('/scratch/look.sh', ctx), 'text-shell');
  assert.equal(decisionOf(checkBash('bash /scratch/look.sh', ctx, 0, input)), 'allow');
  assert.equal(decisionOf(checkBash('/scratch/look.sh', ctx, 0, input)), 'allow');
  // The script's rm gets the decision of the same rm typed on the line.
  assert.equal(decisionOf(checkBash('rm -rf apps', ctx, 0, input)), 'deny');
  assert.equal(decisionOf(checkBash('bash /scratch/clean.sh', ctx, 0, input)), 'deny');
});

test('asks for a script it cannot judge', () => {
  const ctx = fakeCtx({
    '/scratch/bin.sh': '#!/bin/sh\n\0\x01\x02',
    '/scratch/src.sh': '#!/bin/sh\nsource /tmp/x.sh\n',
    '/tmp/x.sh': '#!/bin/sh\nls\n',
    '/scratch/big.sh': `#!/bin/sh\n${'a'.repeat(2 * 1024 * 1024)}\n`,
  });
  // The FIFO and the missing file are unreadable: the fake answers null for both.
  for (const c of [
    'bash /scratch/bin.sh',
    'bash /scratch/fifo.sh',
    'bash /scratch/big.sh',
    'bash /scratch/src.sh',
    'bash /scratch/missing.sh',
  ]) {
    assert.equal(decisionOf(checkBash(c, ctx, 0, input)), 'ask', c);
  }
});

test('needs a shell to run a shell script', () => {
  const ctx = fakeCtx({
    'tools/ok.sh': '#!/bin/sh\nls -la\n',
    'tools/x.py': 'print(1)\n',
    '/scratch/flag.sh': '#!/usr/bin/env bash -x\nls\n',
  });
  assert.equal(decisionOf(checkBash('bash tools/ok.sh', ctx, 0, input)), 'allow');
  for (const c of ['python3 tools/ok.sh', 'node tools/ok.sh', 'bash /scratch/flag.sh', 'bash tools/x.py']) {
    assert.equal(decisionOf(checkBash(c, ctx, 0, input)), 'ask', c);
  }
});

test('takes only real script tokens', () => {
  const ctx = fakeCtx();
  for (const c of ["rg '//' src", 'ls /**', "git log --grep '/fix/'", "python3 '//'", 'node /**']) {
    assert.equal(checkBash(c, ctx, 0, input), null, c);
  }
  assert.equal(
    indirections("rg '//' src").some((x) => x.kind === 'script'),
    false,
  );
});

test('denies inline code that writes a harness file', () => {
  const ctx = fakeCtx({
    '/scratch/w.py': "open('eslint.config.mjs', 'w').write('x')\n",
    '/scratch/w.sh': '#!/bin/sh\necho x > eslint.config.mjs\n',
  });
  for (const c of [
    `python3 -c "open('eslint.config.mjs','w').write('x')"`,
    `node -e "require('fs').writeFileSync('apps/api/src/a.test.ts', '')"`,
    "python3 - <<'EOF'\nopen('.github/workflows/ci.yml', 'w').write('x')\nEOF",
    'python3 /scratch/w.py',
    'bash /scratch/w.sh',
  ]) {
    const r = checkBash(c, ctx, 0, input);
    assert.equal(r?.decision, 'deny', c);
    assert.match(r.reason, /Edit tool/, c);
  }
  // Self-protected files and the quality baseline keep their ask (GPR-10, AD-165).
  for (const c of [
    `node -e "require('fs').writeFileSync('.claude/hooks/gate.mjs', '')"`,
    `python3 -c "open('.quality-baseline.json', 'w').write('{}')"`,
  ]) {
    assert.equal(decisionOf(checkBash(c, ctx, 0, input)), 'ask', c);
  }
});

test('judges a command word by its last segment', () => {
  const ctx = fakeCtx();
  for (const [typed, bare] of [
    ['/bin/rm -rf apps', 'rm -rf apps'],
    ['/usr/bin/git push origin main', 'git push origin main'],
    ['./git push --force', 'git push --force'],
  ]) {
    assert.equal(
      decisionOf(checkBash(typed, ctx, 0, input)),
      decisionOf(checkBash(bare, ctx, 0, input)),
      typed,
    );
  }
  assert.equal(decisionOf(checkBash('/bin/rm -rf apps', ctx, 0, input)), 'deny');
  assert.equal(decisionOf(checkBash('./git push --force', ctx, 0, input)), 'deny');
});

test('skips comments whole', () => {
  const ctx = fakeCtx({
    '/scratch/note.sh': "#!/bin/sh\n# don't touch this\nls -la\n",
    '/scratch/slash.sh': '#!/bin/sh\n# ends with a backslash \\\nls -la\n',
    '/scratch/after.sh': "#!/bin/sh\n# it's fine\nrm -rf apps\n",
  });
  assert.equal(decisionOf(checkBash('bash /scratch/note.sh', ctx, 0, input)), 'allow');
  assert.equal(decisionOf(checkBash('bash /scratch/slash.sh', ctx, 0, input)), 'allow');
  assert.equal(decisionOf(checkBash('bash /scratch/after.sh', ctx, 0, input)), 'deny');
});
