// Static checks of the k6 journey (stream-egress SEG-06, SEG-07). k6 is not run here, so the shape of the script is read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRESENCE_EVERY_SECONDS } from '../../load/lib/journey-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const journey = readFileSync(path.join(root, 'scripts/load/k6/journey.mjs'), 'utf8');

test('the presence read is 12 an hour: one per player every 300 seconds', () => {
  assert.equal(PRESENCE_EVERY_SECONDS, 300);
  assert.equal(3600 / PRESENCE_EVERY_SECONDS, 12);
});

test('the site reads at the rate the journey does', () => {
  const app = readFileSync(path.join(root, 'apps/web/src/app/App.tsx'), 'utf8');
  const match = /export const AGENT_PRESENCE_REREAD_MS = ([0-9_]+);/.exec(app);
  assert.ok(match, 'the site names its presence read interval');
  assert.equal(Number(match[1].replace(/_/g, '')), PRESENCE_EVERY_SECONDS * 1000);
});

test('the journey reads each player presence once per period, as the site does', () => {
  const scenario = journey.slice(journey.indexOf('presence: {'), journey.indexOf('match: {'));
  assert.match(scenario, /executor: 'constant-arrival-rate'/);
  assert.match(scenario, /rate: COUNT,/, 'every player once per period');
  assert.match(scenario, /timeUnit: PRESENCE_EVERY_SECONDS \+ 's'/);
  assert.match(scenario, /exec: 'presence'/);
  const read = journey.slice(
    journey.indexOf('export function presence()'),
    journey.indexOf('/** One join of the player'),
  );
  assert.match(read, /\/v1\/agents\/me/, 'the route the site reads (apps/web api-client myAgent)');
  assert.match(read, /siteHeaders\(player\)/, 'with the site cookie, as the site does');
  assert.match(read, /exec\.scenario\.iterationInInstance % COUNT/, 'the players in turn');
});

test('the host counts a room once, at its created frame, in the window of the frame', () => {
  assert.match(journey, /const roomsCreated = new Counter\('journey_rooms_created'\)/);
  assert.match(journey, /if \(hosting && frame\.stage === 'created'\) tally\(roomsCreated, nowMs\(\)\);/);
  assert.match(journey, /'journey_rooms_created',\n\]/, 'the counter has a measured-window threshold');
  assert.match(journey, /roomsCreated: measuredOf\(data, 'journey_rooms_created'\)/);
});

test('the script keeps to what the k6 bundler takes: no optional chaining, no object spread', () => {
  const code = journey.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\?\./);
  assert.doesNotMatch(code, /\.\.\.[A-Za-z_]/);
});
