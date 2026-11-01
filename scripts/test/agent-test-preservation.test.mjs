// Assertion preservation (AHM-20, AD-082). The agent's integration tests move from core/tests to adapters/tests, and no
// assertion may change on the way: every assertion statement of the baseline files (core/tests at b1519d6) must occur in
// the current test files the same number of times, whichever file it sits in now. A moved file is found by git rename
// detection, and a file with neither its path nor a rename is a violation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_COMMIT = 'b1519d6';
const BASELINE_DIR = 'apps/agent/src-tauri/core/tests';
const TEST_DIRS = [BASELINE_DIR, 'apps/agent/src-tauri/adapters/tests'];
const FIXTURE_DIR = path.join(root, 'scripts/test/fixtures/agent-test-preservation');

// Rust source reduced to what an assertion is made of. Comments are dropped and whitespace outside string literals is
// dropped, so a reflowed assertion reads the same. Literals (strings, raw strings, char literals) are copied as they are,
// so a `//` or an `assert!(` inside one is not code.
const RAW_START = /r(#*)"/y;
const CHAR_LITERAL = /'(?:\\.|[^'\\\n])'/y;

// The index just past the literal that starts at `i`, or -1 when no literal starts there.
const literalEnd = (text, i) => {
  if (text[i] === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (text[i] === 'r' && (i === 0 || !/\w/.test(text[i - 1]))) {
    RAW_START.lastIndex = i;
    const start = RAW_START.exec(text);
    if (start) {
      const close = `"${start[1]}`;
      const end = text.indexOf(close, i + start[0].length);
      return end === -1 ? text.length : end + close.length;
    }
  }
  if (text[i] === "'") {
    CHAR_LITERAL.lastIndex = i;
    const literal = CHAR_LITERAL.exec(text);
    if (literal) return i + literal[0].length;
  }
  return -1;
};

export const rustCode = (source) => {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const end = literalEnd(source, i);
    if (end !== -1) {
      out += source.slice(i, end);
      i = end;
    } else if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i);
      i = newline === -1 ? source.length : newline;
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
    } else {
      if (!/\s/.test(source[i])) out += source[i];
      i += 1;
    }
  }
  return out;
};

// The index of the parenthesis that closes the one at `open`.
const closingParen = (code, open) => {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const end = literalEnd(code, i);
    if (end !== -1) {
      i = end;
      continue;
    }
    if (code[i] === '(') depth += 1;
    if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return code.length - 1;
};

// `assert!`, `assert_eq!`, `assert_ne!`, `debug_assert*!`: the statement from its name to its closing parenthesis.
const ASSERT_START = /(?<!\w)(?:debug_)?assert\w*!\(/y;

export const assertionStatements = (source) => {
  const code = rustCode(source);
  const found = [];
  let i = 0;
  while (i < code.length) {
    const end = literalEnd(code, i);
    if (end !== -1) {
      i = end;
      continue;
    }
    ASSERT_START.lastIndex = i;
    const start = ASSERT_START.exec(code);
    if (start) {
      const close = closingParen(code, i + start[0].length - 1);
      found.push(code.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return found;
};

// Multiset difference of the assertion statements of two sets of sources.
export const assertionDiff = (baselineSources, currentSources) => {
  const tally = (sources) => {
    const counts = new Map();
    for (const source of sources) {
      for (const statement of assertionStatements(source))
        counts.set(statement, (counts.get(statement) ?? 0) + 1);
    }
    return counts;
  };
  const before = tally(baselineSources);
  const after = tally(currentSources);
  const surplus = (from, against) =>
    [...from].flatMap(([statement, count]) =>
      Array.from({ length: Math.max(0, count - (against.get(statement) ?? 0)) }, () => statement),
    );
  return { removed: surplus(before, after), added: surplus(after, before) };
};

// Pure check: `baseline` and `current` are [{ path, source }]; `renamed` maps a baseline path to its moved path.
export const preservationViolations = ({ baseline, current, renamed = new Map() }) => {
  const currentPaths = new Set(current.map((file) => file.path));
  const missing = baseline
    .filter((file) => !currentPaths.has(file.path) && !currentPaths.has(renamed.get(file.path)))
    .map((file) => `${file.path} is missing: no file at its path and no rename`);
  const { removed, added } = assertionDiff(
    baseline.map((file) => file.source),
    current.map((file) => file.source),
  );
  return [
    ...missing,
    ...removed.map((statement) => `removed assertion: ${statement}`),
    ...added.map((statement) => `added assertion: ${statement}`),
  ];
};

// Subprocess git runs with the hook variables removed: inside Lefthook, GIT_DIR and GIT_INDEX_FILE would point at the
// real repository and its index.
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (...args) =>
  execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8', maxBuffer: 64 << 20 });

const baselineFiles = () =>
  git('ls-tree', '-r', '--name-only', BASELINE_COMMIT, '--', BASELINE_DIR)
    .split('\n')
    .filter((file) => file.endsWith('.rs'))
    .map((file) => ({ path: file, source: git('show', `${BASELINE_COMMIT}:${file}`) }));

const currentFiles = () =>
  TEST_DIRS.flatMap((dir) => {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { recursive: true })
      .map((entry) => entry.split(path.sep).join('/'))
      .filter((rel) => rel.endsWith('.rs'))
      .map((rel) => ({ path: `${dir}/${rel}`, source: readFileSync(path.join(abs, rel), 'utf8') }));
  });

// Git rename detection between the baseline commit and the working tree, over the test directories.
const renames = () => {
  const moved = new Map();
  for (const line of git('diff', '-M', '--name-status', BASELINE_COMMIT, '--', ...TEST_DIRS).split('\n')) {
    const [status, from, to] = line.split('\t');
    if (status?.startsWith('R') && to !== undefined) moved.set(from, to);
  }
  return moved;
};

const fixture = (name) => readFileSync(path.join(FIXTURE_DIR, name), 'utf8');

test('moved tests keep every assertion line', () => {
  const violations = preservationViolations({
    baseline: baselineFiles(),
    current: currentFiles(),
    renamed: renames(),
  });
  assert.deepEqual(violations, []);
});

test('an edited expected value in a moved test is reported', () => {
  const violations = preservationViolations({
    baseline: [{ path: `${BASELINE_DIR}/heartbeat.rs`, source: fixture('baseline.rs') }],
    current: [{ path: 'apps/agent/src-tauri/adapters/tests/heartbeat.rs', source: fixture('edited.rs') }],
    renamed: new Map([[`${BASELINE_DIR}/heartbeat.rs`, 'apps/agent/src-tauri/adapters/tests/heartbeat.rs']]),
  });
  assert.deepEqual(violations, [
    'removed assertion: assert_eq!(status,204)',
    'added assertion: assert_eq!(status,200)',
  ]);
});

test('an unchanged test found by rename detection passes', () => {
  const violations = preservationViolations({
    baseline: [{ path: `${BASELINE_DIR}/heartbeat.rs`, source: fixture('baseline.rs') }],
    current: [{ path: 'apps/agent/src-tauri/adapters/tests/heartbeat.rs', source: fixture('baseline.rs') }],
    renamed: new Map([[`${BASELINE_DIR}/heartbeat.rs`, 'apps/agent/src-tauri/adapters/tests/heartbeat.rs']]),
  });
  assert.deepEqual(violations, []);
});

test('a baseline file with neither its path nor a rename is reported missing', () => {
  const violations = preservationViolations({
    baseline: [{ path: `${BASELINE_DIR}/heartbeat.rs`, source: fixture('baseline.rs') }],
    current: [],
  });
  assert.ok(
    violations.includes(`${BASELINE_DIR}/heartbeat.rs is missing: no file at its path and no rename`),
    violations.join('\n'),
  );
});

test('a reflowed assertion is the same assertion, and a string holding assert! is not one', () => {
  const reflowed = 'fn t() {\n    assert_eq!(\n        status,\n        204\n    );\n}\n';
  const plain = 'fn t() {\n    assert_eq!(status, 204);\n}\n';
  const inString = 'fn t() {\n    let s = "assert!(x)";\n    assert_eq!(s, "a // b");\n}\n';
  assert.deepEqual(assertionDiff([reflowed], [plain]), { removed: [], added: [] });
  assert.deepEqual(assertionStatements(inString), ['assert_eq!(s,"a // b")']);
});
