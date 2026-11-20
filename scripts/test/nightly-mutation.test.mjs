import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCargoMutants, fromStryker, isReadingModule } from '../nightly/mutation.mjs';
import { mergeOutcomes } from '../nightly/merge-mutants.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nightly');
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

test('cargo-mutants: counts, score and survivors grouped by file (NGT-04)', () => {
  const r = fromCargoMutants(load('cargo-mutants-domain.json'), []);
  assert.equal(r.baseline, 'ok');
  assert.deepEqual(r.counts, { caught: 3, missed: 3, timeout: 1, unviable: 2 });
  assert.equal(r.score, 57.14); // (caught + timeout) / (caught + timeout + missed)
  assert.deepEqual(
    r.survivors.map((s) => [s.file, s.mutants.length]),
    [
      ['domain/src/anchors.rs', 2],
      ['domain/src/name_diff.rs', 1],
    ],
  );
  const first = r.survivors[0].mutants[0];
  assert.equal(first.line, 182);
  assert.match(first.mutation, /^replace match guard/);
  assert.ok(first.line <= r.survivors[0].mutants[1].line, 'mutants are sorted by line');
});

test('cargo-mutants: survivors in a reading module are marked (NGT-04)', () => {
  const r = fromCargoMutants(load('cargo-mutants-domain.json'), ['domain/src/anchors.rs']);
  assert.deepEqual(
    r.survivors.map((s) => [s.file, s.reading]),
    [
      ['domain/src/anchors.rs', true],
      ['domain/src/name_diff.rs', false],
    ],
  );
});

test('isReadingModule matches whole paths, not name fragments', () => {
  assert.equal(isReadingModule('domain/src/anchors.rs', ['domain/src/anchors.rs']), true);
  assert.equal(isReadingModule('domain/src/anchors.rs', ['src/anchors.rs']), true);
  assert.equal(isReadingModule('domain/src/my_anchors.rs', ['anchors.rs']), false);
  assert.equal(isReadingModule('domain/src/anchors.rs', []), false);
});

test('cargo-mutants: a failed baseline says so and shows no score (NGT-04)', () => {
  const r = fromCargoMutants(load('cargo-mutants-core-baseline-failed.json'), []);
  assert.equal(r.baseline, 'failed');
  assert.equal(r.score, null);
  assert.deepEqual(r.survivors, []);
});

test('cargo-mutants: the adapters survivor of run 44558970584', () => {
  const r = fromCargoMutants(load('cargo-mutants-adapters.json'), []);
  assert.deepEqual(r.counts, { caught: 3, missed: 1, timeout: 0, unviable: 1 });
  assert.equal(r.score, 75);
  assert.deepEqual(r.survivors, [
    {
      file: 'adapters/src/http/sse.rs',
      reading: false,
      mutants: [
        { line: 60, mutation: 'replace ready_check_open_from_body -> Option<ReadyCheckOpen> with None' },
      ],
    },
  ]);
});

test('cargo-mutants: an empty report has no score', () => {
  const r = fromCargoMutants({ outcomes: [] });
  assert.equal(r.score, null);
  assert.equal(r.baseline, 'ok');
});

test('Stryker: counts, score and survivors (NGT-04)', () => {
  const r = fromStryker(load('stryker-report.json'));
  assert.equal(r.baseline, 'ok');
  assert.deepEqual(r.counts, { caught: 2, missed: 2, timeout: 1, unviable: 1 });
  assert.equal(r.score, 60); // (killed + timeout) / valid = 3 / 5
  assert.deepEqual(r.survivors, [
    {
      file: 'src/modules/queues/domain/ticket.ts',
      reading: false,
      mutants: [
        { line: 5, mutation: 'StringLiteral: ""' },
        { line: 22, mutation: 'EqualityOperator: a !== b' },
      ],
    },
  ]);
});

test('merge: shards become one outcomes file the ratchet reads (NGT-01)', () => {
  const a = load('cargo-mutants-domain.json');
  const b = load('cargo-mutants-adapters.json');
  const merged = mergeOutcomes([a, b]);
  assert.equal(merged.outcomes.filter((o) => o.scenario === 'Baseline').length, 1);
  assert.equal(merged.total_mutants, a.total_mutants + b.total_mutants);
  assert.equal(merged.missed, a.missed + b.missed);
  assert.equal(merged.caught, a.caught + b.caught);
  assert.equal(merged.timeout, a.timeout + b.timeout);
  assert.equal(merged.unviable, a.unviable + b.unviable);
  const direct = fromCargoMutants(merged);
  assert.equal(direct.counts.missed, 4);
  assert.equal(direct.score, 63.64); // (6 + 1) / (7 + 4)
});

test('merge: one failed baseline fails the crate', () => {
  const ok = load('cargo-mutants-domain.json');
  const failed = load('cargo-mutants-core-baseline-failed.json');
  assert.equal(fromCargoMutants(mergeOutcomes([ok, failed])).baseline, 'failed');
  assert.equal(fromCargoMutants(mergeOutcomes([failed, ok])).baseline, 'failed');
});

test('merge: a single shard is unchanged in content and the start and end span the shards', () => {
  const a = {
    ...load('cargo-mutants-adapters.json'),
    start_time: '2026-01-02T00:00:00Z',
    end_time: '2026-01-02T01:00:00Z',
  };
  const b = {
    ...load('cargo-mutants-domain.json'),
    start_time: '2026-01-01T00:00:00Z',
    end_time: '2026-01-03T00:00:00Z',
  };
  assert.deepEqual(mergeOutcomes([a]).outcomes, a.outcomes);
  const m = mergeOutcomes([a, b]);
  assert.equal(m.start_time, '2026-01-01T00:00:00Z');
  assert.equal(m.end_time, '2026-01-03T00:00:00Z');
  assert.throws(() => mergeOutcomes([]));
});
