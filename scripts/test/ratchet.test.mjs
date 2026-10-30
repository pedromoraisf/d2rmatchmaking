import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareBaselines, evaluate, tighten } from '../lib/ratchet.mjs';

const base = {
  updated: '2026-10-30',
  metrics: {
    'harness.percent': { value: 90, direction: 'higher', floor: 80, contexts: ['pr', 'nightly'] },
    'mutation.api.domain': {
      value: null,
      direction: 'higher',
      floor: 80,
      tolerance: 0.02,
      contexts: ['nightly'],
    },
    'ci.duration_seconds': {
      value: 300,
      direction: 'lower',
      ceiling: 900,
      tolerance: 0.25,
      contexts: ['pr'],
    },
  },
};

test('compareBaselines: tightening is fine, every loosening is reported', () => {
  const tighter = structuredClone(base);
  tighter.metrics['harness.percent'].value = 95;
  tighter.metrics['ci.duration_seconds'].ceiling = 600;
  assert.deepEqual(compareBaselines(base, tighter), []);

  const looser = structuredClone(base);
  looser.metrics['harness.percent'].value = 85;
  looser.metrics['harness.percent'].floor = 70;
  looser.metrics['ci.duration_seconds'].ceiling = 1200;
  looser.metrics['ci.duration_seconds'].tolerance = 0.5;
  looser.metrics['mutation.api.domain'].contexts = [];
  assert.equal(compareBaselines(base, looser).length, 5);

  const removed = structuredClone(base);
  delete removed.metrics['harness.percent'];
  assert.match(compareBaselines(base, removed)[0], /removed/);
});

test('evaluate: floors, ceilings, tolerance and missing sensors', () => {
  let r = evaluate(base, { 'harness.percent': 92, 'ci.duration_seconds': 360 }, 'pr');
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.improvements, { 'harness.percent': 92 });

  r = evaluate(base, { 'harness.percent': 89, 'ci.duration_seconds': 380 }, 'pr');
  assert.equal(r.failures.length, 2); // below value and above 300 * 1.25

  r = evaluate(base, { 'ci.duration_seconds': 200 }, 'pr');
  assert.match(r.failures[0], /missing now/);

  r = evaluate(base, {}, 'nightly');
  assert.ok(r.notes.some((n) => n.includes('mutation.api.domain')));
  assert.ok(r.failures.some((f) => f.includes('harness.percent')));

  r = evaluate(base, { 'mutation.api.domain': 75, 'harness.percent': 90 }, 'nightly');
  assert.match(r.failures[0], /below the floor 80/);
});

test('tighten: applies only improvements and never loosens', () => {
  const r = evaluate(base, { 'harness.percent': 93, 'ci.duration_seconds': 250 }, 'pr');
  const next = tighten(base, r.improvements, '2026-11-01');
  assert.equal(next.metrics['harness.percent'].value, 93);
  assert.equal(next.metrics['ci.duration_seconds'].value, 250);
  assert.deepEqual(compareBaselines(base, next), []);
  assert.equal(next.updated, '2026-11-01');
});
