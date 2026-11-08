import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, expandOptions, MAX_LINE_BYTES } from '../lib/shell-parse.mjs';

const texts = (seg) => seg.words.map((w) => w.text);
const first = (line) => parseLine(line).segments[0];

test('lists every unsafe shape', () => {
  const cases = {
    'cat a\nrm b': 'newline',
    'cat a\rrm b': 'carriage-return',
    'cat a; rm b': 'semicolon',
    'cat a || rm b': 'or',
    'cat a & rm b': 'background',
    'cat a |& grep x': 'pipe-stderr',
    'echo $HOME': 'dollar',
    'echo "$HOME"': 'dollar',
    'echo `ls`': 'backtick',
    'echo "`ls`"': 'backtick',
    'grep x <(cat y)': 'process-sub',
    'cat >(tee a)': 'process-sub',
    'cat <x': '<',
    'cat << EOF': '<<',
    'cat <<< x': '<<<',
    'echo x >| f': '>|',
    'echo x >&f': '>&word',
    '(cat a)': 'subshell',
    'cat ~/x': 'tilde',
    'echo {a,b}': 'brace',
    'echo }': 'brace',
    'cat .e*': 'glob',
    'cat x?': 'glob',
    'cat [ab]': 'glob',
    'cat .en{v,v}': 'brace',
    "git log -p -- '.e*'": 'git-pathspec',
    "git ls-files ':(glob).e*'": 'git-pathspec',
    'cat $(ls)': 'dollar',
    'ls > out.txt': 'redirect',
    'cat a 2>x': 'redirect',
    'cat a\\b': 'backslash',
  };
  for (const [line, label] of Object.entries(cases)) {
    const { unsafe } = parseLine(line);
    assert.ok(unsafe.includes(label), `${JSON.stringify(line)} should list ${label}, got ${unsafe}`);
  }
});

test('keeps single-quoted text as one word', () => {
  const grep = first(`grep 'a | b' f`);
  assert.deepEqual(texts(grep), ['grep', 'a | b', 'f']);
  assert.equal(grep.words[1].quoted, 'single');
  assert.deepEqual(parseLine(`grep 'a | b' f`).operators, []);

  const h = first(`curl -H'Accept: x' u`);
  assert.deepEqual(texts(h), ['curl', '-HAccept: x', 'u']);
  assert.equal(h.words[1].safe, true);

  const literal = first(`sed -n 'x$p' a.txt`);
  assert.equal(literal.words[2].text, 'x$p');
  assert.equal(literal.words[2].expands, false);
  assert.deepEqual(parseLine(`sed -n 'x$p' a.txt`).unsafe, []);

  const dq = first(`echo "x$"`);
  assert.equal(dq.words[1].expands, true);
  assert.equal(dq.words[1].safe, false);

  assert.deepEqual(parseLine(`echo 'a;b' && pwd`).operators, ['&&']);
  assert.deepEqual(parseLine(`echo 'a;b' && pwd`).unsafe, []);
});

test('takes out only the four whole tokens', () => {
  const line = parseLine('cat a 2>&1 | head -n 5');
  assert.deepEqual(line.segments.map(texts), [
    ['cat', 'a'],
    ['head', '-n', '5'],
  ]);
  assert.deepEqual(line.operators, ['|']);
  assert.deepEqual(line.unsafe, []);

  for (const tail of ['>/dev/null', '2>/dev/null', '&>/dev/null', '2>&1']) {
    const parsed = parseLine(`echo a ${tail}`);
    assert.deepEqual(texts(parsed.segments[0]), ['echo', 'a'], tail);
    assert.deepEqual(parsed.segments[0].redirections, [], tail);
    assert.deepEqual(parsed.unsafe, [], tail);
  }

  const quotedTok = first('echo "2>&1"');
  assert.deepEqual(texts(quotedTok), ['echo', '2>&1']);

  const out = parseLine('cat a > out.txt');
  assert.deepEqual(out.segments[0].redirections, [{ op: '>', target: 'out.txt' }]);
  assert.ok(out.unsafe.includes('redirect'));

  const fd = parseLine('cat a 2>x');
  assert.deepEqual(fd.segments[0].redirections, [{ op: '>', fd: 2, target: 'x' }]);

  const near = parseLine('echo a >/dev/nullx');
  assert.equal(near.segments[0].redirections.length, 1);
  assert.ok(near.unsafe.includes('redirect'));
});

test('expands options', () => {
  const opts = (line, spec) => expandOptions(first(line).words.slice(1), spec);

  const cluster = opts('ls -la dir', { valued: [] });
  assert.deepEqual(
    cluster.options.map((o) => o.name),
    ['-l', '-a'],
  );
  assert.deepEqual(texts({ words: cluster.operands }), ['dir']);

  const head = opts('head -20 f', { valued: ['-n', '-c'], digitsAsN: true });
  assert.equal(head.options[0].name, '-n');
  assert.equal(head.options[0].values[0].text, '20');
  assert.equal(head.options[0].glued, true);

  const glued = opts('grep -A3 x f', { valued: ['-A', '-B', '-C', '-m'] });
  assert.equal(glued.options[0].name, '-A');
  assert.equal(glued.options[0].values[0].text, '3');

  const gluedN = opts('head -n20 f', { valued: ['-n'] });
  assert.equal(gluedN.options[0].values[0].text, '20');
  assert.equal(gluedN.options[0].glued, true);

  const separate = opts('grep -A 3 x f', { valued: ['-A'] });
  assert.equal(separate.options[0].values[0].text, '3');
  assert.equal(separate.options[0].glued, undefined);
  assert.deepEqual(texts({ words: separate.operands }), ['x', 'f']);

  const eq = opts('git log --format=oneline', { valued: ['--format'] });
  assert.equal(eq.options[0].name, '--format');
  assert.equal(eq.options[0].values[0].text, 'oneline');

  const arg = opts('jq --arg N V .', { valued: ['--arg'], arity: { '--arg': 2 } });
  assert.deepEqual(
    arg.options[0].values.map((w) => w.text),
    ['N', 'V'],
  );
  assert.deepEqual(texts({ words: arg.operands }), ['.']);

  const after = opts('cat -- -n', { valued: [] });
  assert.deepEqual(after.options, []);
  assert.deepEqual(texts({ words: after.operands }), ['-n']);
});

test('fails closed on what it cannot read', () => {
  for (const line of ['echo "abc', "echo 'x", 'cat >', `echo "a`]) {
    const parsed = parseLine(line);
    assert.deepEqual(parsed.unsafe, ['unparsed'], line);
    assert.deepEqual(parsed.segments, [], line);
  }
  const big = parseLine('a'.repeat(MAX_LINE_BYTES + 1));
  assert.deepEqual(big.unsafe, ['unparsed']);
  assert.deepEqual(big.segments, []);
  assert.deepEqual(parseLine('a'.repeat(MAX_LINE_BYTES)).unsafe, []);
});
