import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../lib/shell-parse.mjs';
import { READ_ONLY_TABLE, isSafeWord, matchShape, readOnlyDecision } from '../lib/read-only.mjs';

const shape = (line) => matchShape(parseLine(line));
const rowsOf = (line) => shape(line)?.map((r) => r.row) ?? null;

// One allowed example and one refused-option example per row of the table (GPR-02).
const ROW_CASES = [
  ['cat -n a.txt', 'cat -v a.txt', 'cat'],
  ['sed -n 5p a.txt', 'sed -i 5p a.txt', 'sed'],
  ["sed -n '$p' a.txt", 'sed -n 5p -i a.txt', 'sed'],
  ['grep -n -A 3 foo a.txt', 'grep -r foo a.txt', 'grep'],
  ['rg -n -t js foo', "rg -g '*.ts' foo", 'rg'],
  ['head -n 20 a.txt', 'head -f a.txt', 'head'],
  ['tail -n +5 a.txt', 'tail -F a.txt', 'tail'],
  ['wc -l a.txt', 'wc -L a.txt', 'wc'],
  ['ls -la', 'ls -Q', 'ls'],
  ["find . -name '*.ts'", 'find . -delete', 'find'],
  ['jq -r .name a.json', 'jq -f x.jq a.json', 'jq'],
  ['diff -u a.txt b.txt', 'diff -r a b', 'diff'],
  ['git status --short', 'git status -uall', 'git status'],
  ['git rev-parse --short HEAD', 'git rev-parse --git-dir', 'git rev-parse'],
  ['git ls-files --others', 'git ls-files -s', 'git ls-files'],
  ['git diff --stat HEAD', 'git diff --no-index a b', 'git diff'],
  ['git log --oneline -5', 'git log --out=x', 'git log'],
  ['git show --stat HEAD', 'git show --textconv HEAD', 'git show'],
  ['git branch --show-current', 'git branch -d x', 'git branch'],
  ['git fetch origin --prune', 'git fetch --upload-pack=x origin', 'git fetch'],
  ['gh run view 123 --log', 'gh run view 123 --web', 'gh run view'],
  ['gh run list --limit 5', 'gh run list --repo x', 'gh run list'],
  ['gh pr view 12 --json number,title', 'gh pr view 12 --jq .x', 'gh pr view'],
  ['gh pr list --state open', 'gh pr list -R x', 'gh pr list'],
  ['gh pr checks 12', 'gh pr checks 12 --watch', 'gh pr checks'],
  ['gh pr diff 12 --name-only', 'gh pr diff 12 --template x', 'gh pr diff'],
  ['gh api repos/o/r/pulls --paginate', 'gh api repos/o/r -X POST', 'gh api'],
  [
    'node scripts/phase-status.mjs --json F0',
    'node scripts/phase-status.mjs --write F0',
    'node scripts/phase-status.mjs',
  ],
  [
    'node scripts/attempt.mjs status --feature gate-precision',
    'node scripts/attempt.mjs run --feature x',
    'node scripts/attempt.mjs status',
  ],
  [
    'node scripts/attempt.mjs report --feature f',
    'node scripts/attempt.mjs reset --feature f',
    'node scripts/attempt.mjs report',
  ],
  ['echo hi there', 'echo -e hi', 'echo'],
];

test('matches each table row and refuses its other options', () => {
  for (const [allowed, refused, row] of ROW_CASES) {
    assert.deepEqual(rowsOf(allowed), [row], `${allowed} should match ${row}`);
    assert.equal(shape(refused), null, `${refused} should not match ${row}`);
  }
  // every row of the table has its case above
  const covered = new Set(ROW_CASES.map(([, , row]) => row));
  for (const r of READ_ONLY_TABLE)
    assert.ok(covered.has(r.command.join(' ')), `no case for ${r.command.join(' ')}`);
});

test('refuses the forms AD-163 drops', () => {
  for (const line of [
    'grep -r foo .',
    'grep --recursive foo a.txt',
    'grep -e foo a.txt',
    'grep -f pats.txt a.txt',
    'rg -e foo',
    'rg -g x.ts foo',
    'rg --glob x foo',
    'diff -r a b',
    "awk '{print}' a.txt",
    "sed 's/a/b/' f.txt",
    "sed -n '/x/p' f.txt",
    "sed -n '/x/p;w o/p' f.txt",
    'git log --out=x',
    'git log --onel',
    'gh api repos/o/r -XPOST',
    'gh api repos/o/r --method=POST',
    'gh api repos/o/r --paginate -f a=b',
    'git -c core.pager=x status',
    'git -C dir status',
    'git --git-dir=.git log',
    'git --work-tree=. status',
    'git --exec-path=/x status',
    'git log --format oneline',
    'cat -XPOST a.txt',
  ]) {
    assert.equal(shape(line), null, line);
  }
});

test('matches banned jq words whole', () => {
  assert.equal(shape('jq -n env'), null);
  assert.equal(shape("jq -n '$ENV'"), null);
  assert.equal(shape('jq -n input'), null);
  assert.equal(shape('gh api x --jq env'), null);
  assert.equal(rowsOf("jq '.environment' a.json")?.[0], 'jq');
});

test('needs the bare command word', () => {
  assert.equal(shape('./git log'), null);
  assert.equal(shape('/tmp/cat a.txt'), null);
  assert.equal(rowsOf('git log --oneline')?.[0], 'git log');
});

test('refuses assignments and equals words', () => {
  assert.equal(shape('NAME=value cat a.txt'), null);
  assert.equal(shape('=cat a.txt'), null);
  assert.equal(shape('cat =a'), null);
});

test('a leading cd is allowed only before &&, and nothing else is', () => {
  assert.deepEqual(rowsOf('cd apps && rg -n foo api/package.json 2>/dev/null | head -n 20'), [
    'cd',
    'rg',
    'head',
  ]);
  assert.equal(shape('cd apps | cat a.txt'), null, 'a pipe after cd');
  assert.equal(shape('cd apps'), null, 'cd with nothing after it');
  assert.equal(shape('git status; rm b'), null);
});

test('judges every word as a safe word', () => {
  assert.equal(shape('cat "a.txt"'), null, 'a double-quoted word is not safe');
  assert.equal(shape('cat a.txt $HOME'), null);
  assert.equal(shape('cat a\\ b'), null);
  assert.equal(shape('cat a.txt > out.txt'), null, 'a redirection other than the four whole tokens');
  assert.equal(shape('cat a.txt 2>&1 | head -n 5')?.length, 2, 'the four whole tokens are allowed');
  assert.equal(shape('git status || git log'), null, '||');
  assert.equal(shape('cat a.txt\nrm b'), null, 'a newline');
  assert.equal(shape('cat $(ls)'), null);
  assert.equal(shape('cat .e*'), null, 'an unquoted glob');
  assert.equal(shape('cat a.txt &'), null, 'a background job');
  assert.equal(shape("git log -p -- '.e*'"), null, 'a glob in a git path operand');
});

test('isSafeWord takes only safe characters, single quotes and no leading =', () => {
  const w = (text, quoted = 'none', safe = true, expands = false) => ({ text, quoted, safe, expands });
  assert.equal(isSafeWord(w('a.txt')), true);
  assert.equal(isSafeWord(w('Accept: x', 'single')), true);
  assert.equal(isSafeWord(w('a', 'double', false)), false);
  assert.equal(isSafeWord(w('x', 'none', true, true)), false);
  assert.equal(isSafeWord(w('=x')), false);
  assert.equal(isSafeWord(w('a b', 'none', false)), false);
});

// ---------------------------------------------------------------- part 2: a fake checkout and a fake git

/** A disk of directories and files; `links` map a path to its target; `slow` paths time out in realpath/stat. */
function fakeDisk({ dirs = [], files = {}, links = {}, slow = [] } = {}) {
  const nodes = new Map();
  for (const d of ['/', '/repo', '/tmp', ...dirs]) nodes.set(d, { kind: 'dir', nlink: 1 });
  for (const [p, o] of Object.entries(files)) nodes.set(p, { kind: 'file', nlink: o.nlink ?? 1 });
  const target = (p) => {
    let t = p;
    for (let i = 0; i < 8 && links[t]; i++) t = links[t];
    return t;
  };
  return {
    realpath(p) {
      if (slow.includes(p)) return { timedOut: true };
      const t = target(p);
      return nodes.has(t) ? t : null;
    },
    stat(p) {
      if (slow.includes(p)) return { timedOut: true };
      const node = nodes.get(target(p));
      if (!node) return null;
      return {
        isFile: () => node.kind === 'file',
        isDirectory: () => node.kind === 'dir',
        nlink: node.nlink,
      };
    },
  };
}

/** `git`: rev-parse knows `revs`; ls-files lists the `ignored` paths asked about; `timeout` times every call out. */
function fakeGit({ revs = [], ignored = [], timeout = false } = {}) {
  return (args) => {
    if (timeout) return { timedOut: true };
    if (args[0] === 'rev-parse') return revs.includes(args.at(-1)) ? 'sha' : null;
    if (args.includes('ls-files')) {
      const paths = args.slice(args.indexOf('--') + 1);
      return ignored.filter((p) => paths.includes(p)).join('\n');
    }
    return null;
  };
}

function checkout({ disk = {}, git = {} } = {}) {
  const d = fakeDisk(disk);
  return { root: '/repo', mainRoot: '/repo', realpath: d.realpath, stat: d.stat, git: fakeGit(git) };
}

const decide = (line, input, ctx) => readOnlyDecision(parseLine(line), input, ctx);
const FILES = {
  dirs: ['/repo/apps', '/repo/apps/api'],
  files: { '/repo/apps/api/package.json': {}, '/repo/a.txt': {} },
};

test("decides the spec's independent test", () => {
  const ctx = checkout({ disk: FILES });
  assert.equal(
    decide('cd apps && rg -n foo api/package.json 2>/dev/null | head -n 20', { cwd: '/repo' }, ctx)?.decision,
    'allow',
  );
  assert.equal(decide('rg -n foo apps', { cwd: '/repo' }, ctx), null, 'a directory is not a read path');
  assert.equal(decide('grep KEY apps/api/.env', { cwd: '/repo' }, ctx)?.decision, 'deny');
});

test('denies a secret name in any operand', () => {
  const ctx = checkout({ disk: FILES });
  for (const line of [
    'grep K apps/api/.env',
    'grep -e K apps/api/.env',
    'git show HEAD:.env',
    'git log -p -- .npmrc',
    'jq . .npmrc',
    'cat .ENV',
    'cat apps/api/.Env.local',
    'grep .env README.md',
    'git log -- .git/config',
  ]) {
    assert.equal(decide(line, { cwd: '/repo' }, ctx)?.decision, 'deny', line);
  }
  assert.notEqual(
    decide('cat .env.example', { cwd: '/repo' }, ctx)?.decision,
    'deny',
    '.env.example is not a secret',
  );
});

test('allows nothing outside the checkout', () => {
  const ctx = checkout({
    disk: {
      dirs: ['/etc'],
      files: { '/etc/hosts': {}, '/repo/a.txt': {} },
      links: { '/repo/link.txt': '/etc/hosts' },
    },
  });
  for (const line of [
    'cat ~/.ssh/id_rsa',
    'cat /proc/self/environ',
    'git diff --no-index a b',
    'cat ../a.txt',
    'cat link.txt',
    'cat /etc/hosts',
  ]) {
    assert.notEqual(decide(line, { cwd: '/repo' }, ctx)?.decision, 'allow', line);
  }
  assert.equal(decide('cat a.txt', { cwd: '/repo' }, ctx)?.decision, 'allow', 'the control: a file inside');
});

test("resolves operands against the call's working directory", () => {
  const ctx = checkout({
    disk: {
      dirs: [...FILES.dirs, '/tmp/scratch', '/repo/tools/x', '/repo/.claude/worktrees/gate-precision'],
      files: {
        ...FILES.files,
        '/repo/tools/x/.git': {},
        '/repo/.claude/worktrees/gate-precision/.git': {},
        '/repo/.claude/worktrees/gate-precision/README.md': {},
      },
    },
  });
  assert.equal(decide('cat apps/api/package.json', { cwd: '/repo' }, ctx)?.decision, 'allow');
  assert.equal(
    decide('cat api/package.json', { cwd: '/repo/apps' }, ctx)?.decision,
    'allow',
    'relative to cwd',
  );
  assert.equal(
    decide('cat apps/api/package.json', { cwd: '/repo/apps' }, ctx),
    null,
    'not relative to the root',
  );
  assert.equal(decide('cat a.txt', { cwd: '/tmp/scratch' }, ctx), null, 'a cwd outside the checkout');
  assert.equal(decide('cat a.txt', {}, ctx), null, 'no cwd');
  assert.equal(decide('cat package.json', { cwd: '/repo/tools/x' }, ctx), null, 'a nested repository');
  assert.equal(
    decide('cat README.md', { cwd: '/repo/.claude/worktrees/gate-precision' }, ctx)?.decision,
    'allow',
    'a worktree is not a nested repository',
  );
});

test('allows only plain tracked or untracked files', () => {
  const ctx = checkout({
    disk: {
      ...FILES,
      files: { ...FILES.files, '/repo/h.txt': { nlink: 2 }, '/repo/dist/out.log': {} },
      dirs: [...FILES.dirs, '/repo/dist'],
    },
    git: { ignored: ['dist/out.log'] },
  });
  const input = { cwd: '/repo' };
  assert.equal(decide('cat h.txt', input, ctx), null, 'a hard link');
  assert.equal(decide('cat dist/out.log', input, ctx), null, 'an ignored file');
  assert.equal(decide('cat apps', input, ctx), null, 'a directory');
  assert.equal(decide('head -n 1 apps', input, ctx), null, 'a directory under head');
  assert.equal(decide('cat apps/api/package.json', input, ctx)?.decision, 'allow', 'a plain file');
});

test('stops at its caps and its deadline', () => {
  const input = { cwd: '/repo' };
  const ctx = checkout({
    disk: { dirs: [], files: { '/repo/a.txt': {} } },
    git: { revs: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'] },
  });
  const paths = (n) => ['cat', ...Array(n).fill('a.txt')].join(' ');
  assert.equal(decide(paths(64), input, ctx)?.decision, 'allow', 'the 64-path cap holds 64 paths');
  assert.equal(decide(paths(65), input, ctx), null, 'over the 64-path cap');
  const echo = (n) => ['echo', ...Array(n).fill('a')].join(' ');
  assert.equal(decide(echo(199), input, ctx)?.decision, 'allow', '200 words is the cap');
  assert.equal(decide(echo(200), input, ctx), null, 'over the 200-word cap');
  assert.equal(
    decide(`git show ${['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].join(' ')}`, input, ctx)?.decision,
    'allow',
    'eight spawns',
  );
  assert.equal(
    decide(`git show ${['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'].join(' ')}`, input, ctx),
    null,
    'nine spawns',
  );

  const slowGit = checkout({ disk: { files: { '/repo/a.txt': {} } }, git: { timeout: true } });
  assert.equal(decide('git log -- a.txt', input, slowGit), null, 'a git spawn that times out');

  const slowDisk = checkout({ disk: { files: { '/repo/a.txt': {} }, slow: ['/repo/a.txt'] } });
  assert.equal(decide('cat a.txt', input, slowDisk)?.decision, 'ask', 'a timed-out deny check asks');
});

test('allows the whole history', () => {
  const ctx = checkout({ disk: FILES });
  assert.equal(decide('git log -p', { cwd: '/repo' }, ctx)?.decision, 'allow');
  assert.equal(decide('git show --stat', { cwd: '/repo' }, ctx)?.decision, 'allow');
});

test('refuses a listing that would reach the git directory', () => {
  const ctx = checkout({ disk: FILES });
  assert.equal(decide('find . -name a.txt', { cwd: '/repo' }, ctx), null, 'find from the root holds .git');
  assert.equal(decide('ls -R', { cwd: '/repo' }, ctx), null, 'a recursive listing from the root');
  assert.equal(decide('ls -la', { cwd: '/repo' }, ctx)?.decision, 'allow', 'a plain listing of the root');
});
