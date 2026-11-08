// GPR-17: the call history lives next to the ledger, keeps ten minutes of hashes with caps, never waits long on a lock,
// sets a corrupt file aside once and never stores a command. Temporary directories only; this is not a mutation proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repeatDecision } from '../lib/polling.mjs';
import {
  applyHistoryEffect,
  emptyHistory,
  historyPath,
  loadHistory,
  withHistory,
} from '../lib/history-store.mjs';

delete process.env.D2RMM_LEDGER; // the test-only override of ledgerPath must not leak into the git check

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function tempDir() {
  return mkdtempSync(path.join(realpathSync(tmpdir()), 'history-'));
}

const git = (cwd, args) =>
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args],
    {
      cwd,
      stdio: 'ignore',
    },
  );

test('stores history next to the ledger', () => {
  const root = tempDir();
  const main = path.join(root, 'main');
  const wt = path.join(root, 'wt');
  mkdirSync(main);
  git(main, ['init', '-q']);
  git(main, ['commit', '-q', '--allow-empty', '-m', 'init']);
  git(main, ['worktree', 'add', '-q', wt, '-b', 'feat/F0-demo']);

  const expected = path.join(realpathSync(path.join(main, '.git')), 'd2rmm', 'history.json');
  assert.equal(historyPath(wt), expected);
  assert.equal(historyPath(main), expected);
  assert.equal(historyPath(root), null, 'outside a repository there is no history file');
});

test('keeps ten minutes and caps entries', () => {
  const file = path.join(tempDir(), 'history.json');

  withHistory(
    file,
    (store) => {
      applyHistoryEffect(store, { op: 'history', sid: 'a', hash: 'old', at: NOW - 11 * MINUTE });
      applyHistoryEffect(store, { op: 'history', sid: 'a', hash: 'fresh', at: NOW - 9 * MINUTE });
    },
    { now: NOW },
  );
  let stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(
    stored.sessions.a.map((e) => e.hash),
    ['fresh'],
    'an entry older than ten minutes is pruned at the write',
  );
  assert.equal(statSync(file).mode & 0o777, 0o600);

  withHistory(
    file,
    (store) => {
      for (let i = 0; i < 60; i++)
        applyHistoryEffect(store, { op: 'history', sid: 'b', hash: `h${i}`, at: NOW - 1000 + i });
    },
    { now: NOW },
  );
  stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.sessions.b.length, 50, 'at most 50 entries per session');
  assert.equal(stored.sessions.b[0].hash, 'h10', 'the newest 50 are kept');
  assert.equal(stored.sessions.b[49].hash, 'h59');

  withHistory(
    file,
    (store) => {
      for (let i = 0; i < 70; i++) {
        applyHistoryEffect(store, { op: 'history', sid: `s${i}`, hash: 'x', at: NOW - (70 - i) * 1000 });
      }
    },
    { now: NOW },
  );
  stored = JSON.parse(readFileSync(file, 'utf8'));
  const sids = Object.keys(stored.sessions);
  assert.equal(sids.length, 64, 'at most 64 sessions');
  assert.ok(sids.includes('s69'), 'the most recently used session is kept');
  assert.equal(sids.includes('s0'), false, 'the least recently used session is dropped');
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('never waits long on the lock', () => {
  const file = path.join(tempDir(), 'history.json');
  withHistory(
    file,
    (store) => applyHistoryEffect(store, { op: 'history', sid: 'a', hash: 'kept', at: Date.now() }),
    {
      now: Date.now(),
    },
  );
  const before = readFileSync(file, 'utf8');

  const lock = `${file}.lock`;
  mkdirSync(lock);
  let seen = null;
  const started = Date.now();
  const value = withHistory(
    file,
    (store) => {
      seen = JSON.stringify(store.sessions);
      return 'ran';
    },
    { now: Date.now() },
  );
  assert.ok(Date.now() - started < 1000, 'a held lock is given up within about 200 ms');
  assert.equal(value, 'ran', 'the decision still runs');
  assert.equal(seen, '{}', 'a locked store reads as empty');
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing is written under a lock that is not ours');
  assert.equal(existsSync(lock), true, 'a fresh lock is not broken');

  const old = (Date.now() - 11_000) / 1000;
  utimesSync(lock, old, old);
  withHistory(
    file,
    (store) => applyHistoryEffect(store, { op: 'history', sid: 'a', hash: 'new', at: Date.now() }),
    {
      now: Date.now(),
    },
  );
  assert.equal(existsSync(lock), false, 'a lock older than 10 s is broken and released');
  assert.deepEqual(
    JSON.parse(readFileSync(file, 'utf8')).sessions.a.map((e) => e.hash),
    ['kept', 'new'],
  );
});

test('sets a corrupt file aside once', () => {
  const dir = tempDir();
  const file = path.join(dir, 'history.json');

  writeFileSync(file, '{not json');
  assert.deepEqual(Object.keys(loadHistory(file).sessions), [], 'a corrupt file reads as empty');
  assert.equal(existsSync(file), false, 'the corrupt file is moved away');
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), '{not json');

  writeFileSync(file, '{"version":1,"sessions":[]}');
  loadHistory(file);
  writeFileSync(file, 'garbage again');
  loadHistory(file);
  assert.deepEqual(readdirSync(dir).sort(), ['history.json.corrupt'], 'one .corrupt file, overwritten');
  assert.equal(readFileSync(`${file}.corrupt`, 'utf8'), 'garbage again');

  writeFileSync(file, '{"version":1,"sessions":{"a":[{"hash":1}]}}');
  assert.deepEqual(Object.keys(loadHistory(file).sessions), [], 'an entry without a string hash is corrupt');
  assert.deepEqual(emptyHistory().sessions, loadHistory(path.join(dir, 'absent.json')).sessions);
});

test('stores no command text', () => {
  const file = path.join(tempDir(), 'history.json');
  const COMMAND = 'git log --oneline -- secret-marker-7731';
  withHistory(
    file,
    (store) => {
      const result = repeatDecision(COMMAND, 'sid-1', store, NOW);
      for (const effect of result.effects) applyHistoryEffect(store, effect);
    },
    { now: NOW },
  );
  const text = readFileSync(file, 'utf8');
  assert.equal(text.includes('secret-marker-7731'), false);
  assert.equal(text.includes('git log'), false);
  const entry = JSON.parse(text).sessions['sid-1'][0];
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'hash']);
  assert.equal(entry.hash, createHash('sha256').update(COMMAND).digest('hex'));
});

test('counts repeats across calls through the store', () => {
  const file = path.join(tempDir(), 'history.json');
  const decisions = [];
  for (let i = 0; i < 5; i++) {
    decisions.push(
      withHistory(
        file,
        (store) => {
          const result = repeatDecision('git status', 'sid-2', store, NOW + i * 1000);
          for (const effect of result.effects) applyHistoryEffect(store, effect);
          return result.decision;
        },
        { now: NOW + i * 1000 },
      ),
    );
  }
  assert.deepEqual(decisions, [null, null, null, null, 'deny'], 'the fifth identical call denies');
});
