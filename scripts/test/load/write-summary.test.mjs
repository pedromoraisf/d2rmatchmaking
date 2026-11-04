import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeSummary, summaryNameOf } from '../../load/lib/write-summary.mjs';

const DIR = '/run/work/out';
const TEMPORARY = `${DIR}/.summary.json.tmp`;
const TARGET = `${DIR}/summary.json`;

/** An in-memory file port that can fail on the write, the rename or the removal. */
function fakeFs({ failWrite = false, failRename = false, failRm = false } = {}) {
  const files = new Map();
  return {
    files,
    async writeFile(path, data) {
      if (failWrite) {
        files.set(path, data.slice(0, 7));
        throw new Error('disk full');
      }
      files.set(path, data);
    },
    async rename(from, to) {
      if (failRename) {
        throw new Error('rename refused');
      }
      if (!files.has(from)) {
        throw new Error(`no such file: ${from}`);
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    async rm(path) {
      if (failRm) {
        throw new Error('rm refused');
      }
      files.delete(path);
    },
  };
}

const full = (overrides = {}) => ({
  profile: 'full',
  passed: true,
  maxConcurrentPlayers: 100,
  steps: [],
  ...overrides,
});

test('whole or absent', async () => {
  const summary = full();

  const ok = fakeFs();
  const written = await writeSummary(ok, DIR, summary);
  assert.equal(written, TARGET);
  assert.deepEqual(JSON.parse(ok.files.get(TARGET)), summary, 'the file holds the whole summary');
  assert.equal(ok.files.has(TEMPORARY), false, 'the temporary file is renamed away');

  const failedWrite = fakeFs({ failWrite: true });
  await assert.rejects(writeSummary(failedWrite, DIR, summary), /disk full/);
  assert.equal(failedWrite.files.has(TARGET), false, 'a failed write leaves no summary');
  assert.equal(failedWrite.files.has(TEMPORARY), false, 'the partial temporary file is removed');

  const failedRename = fakeFs({ failRename: true });
  await assert.rejects(writeSummary(failedRename, DIR, summary), /rename refused/);
  assert.equal(failedRename.files.has(TARGET), false, 'a failed rename leaves no summary');
  assert.equal(failedRename.files.has(TEMPORARY), false);

  const previous = fakeFs({ failWrite: true });
  previous.files.set(TARGET, 'the previous run');
  await assert.rejects(writeSummary(previous, DIR, summary), /disk full/);
  assert.equal(previous.files.get(TARGET), 'the previous run', 'a failed write never touches the old file');

  const stuck = fakeFs({ failRename: true, failRm: true });
  await assert.rejects(
    writeSummary(stuck, DIR, summary),
    /rename refused/,
    'the first failure is the one rethrown',
  );
});

test('a summary of a failed run is written the same way', async () => {
  const failed = full({ passed: false, failure: { step: 100, rule: 'latency' } });
  const port = fakeFs();
  await writeSummary(port, DIR, failed);
  assert.deepEqual(JSON.parse(port.files.get(TARGET)), failed, 'the failed summary is written whole');
});

test('smoke writes smoke-summary.json and never summary.json', async () => {
  const smoke = { profile: 'smoke', passed: true, steps: [] };
  assert.equal(summaryNameOf('smoke'), 'smoke-summary.json');
  assert.equal(summaryNameOf('full'), 'summary.json');

  const port = fakeFs();
  const written = await writeSummary(port, DIR, smoke);
  assert.equal(written, `${DIR}/smoke-summary.json`);
  assert.equal(port.files.has(`${DIR}/smoke-summary.json`), true);
  assert.equal(port.files.has(TARGET), false, 'a smoke run never writes summary.json');

  await assert.rejects(writeSummary(fakeFs(), DIR, { profile: 'nightly' }), TypeError);
});
