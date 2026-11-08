import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../lib/shell-parse.mjs';
import { READ_ONLY_TABLE, isSafeWord, matchShape } from '../lib/read-only.mjs';

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
