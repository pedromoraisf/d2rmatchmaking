// GPR-23 and GPR-24 (gate-precision): the replay extractor keeps by allow-list. Its normalisation, its re-emission of
// Bash commands and its per-tool entries are pure functions, tested here with made-up transcript lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyResult, entryOf, normalise, reemitBash } from '../gate-replay/extract.mjs';

const ENV = {
  repo: '/Users/alice/www/repo',
  user: 'alice',
  scratchpad: '/private/tmp/claude-501/-Users-alice-www-repo/0b49de29-c089-4728-afc3-7b5840e6b5d5/scratchpad',
};

test('normalises paths, ids and long tokens', () => {
  const line = [
    'cat /Users/alice/www/repo/apps/a.ts; cat ~/notes/x.md;',
    'cat /private/tmp/claude-501/-Users-alice-www-repo/0b49de29-c089-4728-afc3-7b5840e6b5d5/scratchpad/r.sh;',
    'curl http://10.0.0.1:8080/x; echo 7f3a9c0e5b1d2a4f6e8c0b9d; mail alice@example.org',
  ].join(' ');
  assert.equal(
    normalise(line, ENV),
    'cat <repo>/apps/a.ts; cat ~/notes/x.md; cat <scratchpad>/r.sh; curl <v>; echo <v>; mail <v>',
  );
  // A name of the form word-with-no-digits stays: a 20-letter path segment is not a token.
  assert.equal(
    normalise('cat apps/api/src/modules/lobby-room/application/x.ts', ENV),
    'cat apps/api/src/modules/lobby-room/application/x.ts',
  );
});

test('keeps only safe words', () => {
  // Quoted strings, option values and URLs become <v>; the command word and options stay.
  assert.equal(reemitBash('curl -H "Authorization: Bearer abc" https://x.example/y'), 'curl -H <v> <v>');
  // The table's words stay exactly as they were.
  assert.equal(reemitBash('git log --oneline -5'), 'git log --oneline -5');
  // A pattern argument and an absolute path outside the checkout are values.
  assert.equal(reemitBash('rg -n secretword /etc/hosts'), 'rg -n <v> <v>');
  // A safe checkout path and a file name with an extension stay; a path with `..` is a value.
  assert.equal(reemitBash('echo x > eslint.config.mjs'), 'echo <v> > eslint.config.mjs');
  assert.equal(reemitBash('cat ../x.md'), 'cat <v>');
  // The whole redirection tokens are kept at the end.
  assert.equal(reemitBash('cat apps/x.ts 2>&1 | head -n 5'), 'cat apps/x.ts | head -n 5 2>&1');
  // Commands on separate lines are re-emitted with `;` between them (a multi-line polling loop is replayed).
  assert.equal(reemitBash('cat a\ncat b'), 'cat <v> ; cat <v>');
  // A here-document body is one placeholder.
  assert.equal(reemitBash("python3 - <<'EOF'\nprint(1)\nEOF").endsWith(' <v>'), true);
});

test('keeps no content or prompt', () => {
  const denied = {
    text: 'PreToolUse:Edit hook error: [d2rmm gate] Edit .quality-baseline.json with the Edit tool.',
    permission: null,
  };
  const edit = entryOf(
    {
      name: 'Edit',
      input: { file_path: '/Users/alice/www/repo/apps/a.ts', new_string: 'SECRET-CONTENT-123' },
    },
    denied,
    ENV,
  );
  assert.ok(edit.entry, 'the edit is kept');
  const json = JSON.stringify(edit.entry);
  assert.ok(!json.includes('SECRET-CONTENT'), 'no new_string');
  assert.deepEqual(edit.entry.input.file_path, '<repo>/apps/a.ts');
  assert.equal(edit.entry.input.size, '<1k');

  const agent = entryOf(
    { name: 'Agent', input: { subagent_type: 'feature-worker', prompt: 'SECRET-PROMPT-456' } },
    { text: 'PreToolUse:Agent hook error: [d2rmm gate] BLOCKED — dispatch', permission: null },
    ENV,
  );
  assert.ok(agent.entry, 'the agent call is kept');
  assert.ok(!JSON.stringify(agent.entry).includes('SECRET-PROMPT'), 'no prompt');
  assert.equal(agent.entry.input.subagent_type, 'feature-worker');
});

test('reads the gate answers and the answered prompts', () => {
  assert.deepEqual(
    classifyResult({
      text: 'PreToolUse:Bash hook error: [d2rmm gate] Quote the whole gate command after "--"',
      permission: null,
    }),
    { decision: 'deny', reason: 'Quote the whole gate command after "--"' },
  );
  assert.deepEqual(classifyResult({ text: 'ok', permission: { source: 'user_temporary' } }), {
    decision: 'ask',
  });
  assert.deepEqual(classifyResult({ text: 'Permission to use Bash with command ls', permission: null }), {
    decision: 'prompt',
  });
  assert.equal(
    classifyResult({ text: 'the file content mentions [d2rmm gate] in a read', permission: null }),
    null,
  );
});
