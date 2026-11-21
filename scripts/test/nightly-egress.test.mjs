// The egress numbers of the nightly report (stream-egress SEG-08): the bytes of each event type at 100 players, and their
// change since the latest earlier nightly. Pure rules, on a summary cut to what they read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLoadSummary } from '../nightly/load.mjs';
import { toMarkdown } from '../nightly/render.mjs';
import { compare } from '../nightly/trend.mjs';

// 175 000 bytes over 100 players in 90 s is 70 000 a player-hour. Event bytes are 90 s of the window: x / 100 / 0.025.
const step = (players, over = {}) => ({
  players,
  errors: 0,
  latencyP95Ms: 20,
  bytesReceived: 175_000,
  windowSeconds: 90,
  roomsCreated: 10,
  passed: true,
  bytesByEvent: {
    site: { 'room.assigned': 25_000, 'room.stage_changed': 12_500 },
    agent: { 'room.assigned': 10_000 },
    other: 127_500,
  },
  matchesPerPlayerHour: 160,
  bytesPerMatch: 437.5,
  ...over,
});
const summary = (over = {}) => ({
  passed: true,
  error: null,
  maxConcurrentPlayers: 100,
  steps: [step(100)],
  ...over,
});
const reportOf = (load) => ({
  commit: 'abc1234',
  branch: 'main',
  suites: ['load'],
  jobs: [],
  mutation: [],
  load,
  acceptance: null,
  trend: null,
});

test('a step carries its bytes by event type per player-hour, with matches and bytes per match', () => {
  const [row] = fromLoadSummary(summary()).steps;
  assert.deepEqual(row.bytesByEvent, {
    site: { 'room.assigned': 10_000, 'room.stage_changed': 5_000 },
    agent: { 'room.assigned': 4_000 },
    other: 51_000,
  });
  assert.equal(row.bytesPerPlayerHour, 70_000);
  assert.equal(row.matchesPerPlayerHour, 160);
  assert.equal(row.bytesPerMatch, 437.5);
});

test('the event types and the rest add up to the step total', () => {
  const [row] = fromLoadSummary(summary()).steps;
  const sum =
    Object.values(row.bytesByEvent.site).reduce((a, b) => a + b, 0) +
    Object.values(row.bytesByEvent.agent).reduce((a, b) => a + b, 0) +
    row.bytesByEvent.other;
  assert.equal(sum, row.bytesPerPlayerHour);
});

test('a run from before the breakdown reports none, and the report still builds', () => {
  const old = fromLoadSummary(
    summary({
      steps: [
        step(100, { bytesByEvent: undefined, matchesPerPlayerHour: undefined, bytesPerMatch: undefined }),
      ],
    }),
  );
  assert.equal(old.steps[0].bytesByEvent, null);
  assert.equal(old.steps[0].matchesPerPlayerHour, null);
  assert.doesNotMatch(toMarkdown(reportOf(old)), /by event type/);
});

test('the markdown lists the event types at 100 players, largest first, with their share and the cadence', () => {
  const markdown = toMarkdown(reportOf(fromLoadSummary(summary())));
  assert.match(markdown, /Bytes per player-hour by event type at 100 players:/);
  const lines = markdown.split('\n').filter((line) => /^\| (site|agent|other) \|/.test(line));
  assert.equal(lines.length, 4, 'three events with bytes and the rest; events with none are left out');
  assert.match(lines[0], /^\| other \| HTTP bodies, headers and framing \| 51000 \| 72\.9 % \|$/);
  assert.match(lines[1], /^\| site \| room\.assigned \| 10000 \| 14\.3 % \|$/);
  assert.doesNotMatch(markdown, /room\.run_opened/);
  assert.match(markdown, /plays 160 matches per player-hour, so a match costs 437\.5 bytes/);
});

test('the breakdown is the 100-player step, not another', () => {
  const load = fromLoadSummary(summary({ steps: [step(50), step(100), step(200)] }));
  const markdown = toMarkdown(reportOf(load));
  assert.equal(markdown.split('Bytes per player-hour by event type at 100 players:').length, 2, 'once');
});

test('the trend gives the change of each event type, only for those that changed', () => {
  const now = reportOf(fromLoadSummary(summary()));
  const before = reportOf(
    fromLoadSummary(
      summary({
        steps: [
          step(100, {
            bytesReceived: 200_000,
            bytesByEvent: {
              site: { 'room.assigned': 50_000, 'room.stage_changed': 12_500 },
              agent: { 'room.assigned': 10_000 },
              other: 127_500,
            },
            matchesPerPlayerHour: 150,
            bytesPerMatch: 500,
          }),
        ],
      }),
    ),
  );
  const trend = compare(now, before);
  assert.deepEqual(trend.load.bytesByEvent, { 'site room.assigned': -10_000 });
  assert.equal(trend.load.matchesPerPlayerHour, 10);
  assert.equal(trend.load.bytesPerMatch, -62.5);
  const markdown = toMarkdown({ ...now, trend });
  assert.match(markdown, /Bytes per player-hour by event type: site room\.assigned -10000\./);
});

test('no change between two runs says so; an earlier run without a breakdown gives no event comparison', () => {
  const now = reportOf(fromLoadSummary(summary()));
  const same = compare(now, now);
  assert.deepEqual(same.load.bytesByEvent, {});
  assert.match(toMarkdown({ ...now, trend: same }), /by event type: no change\./);

  const older = reportOf(fromLoadSummary(summary({ steps: [step(100, { bytesByEvent: undefined })] })));
  const trend = compare(now, older);
  assert.equal(trend.load.bytesByEvent, null);
  assert.doesNotMatch(toMarkdown({ ...now, trend }), /by event type: /);
});

test('with no previous report the trend stays empty, as before', () => {
  assert.equal(compare(reportOf(fromLoadSummary(summary())), null), null);
});
