// The smoke check (tasks T32, C47): run after `pnpm test:load:smoke`, it reads `reports/load/smoke-summary.json` and asserts
// what the smoke run must prove (LB-01, LB-02, LB-03, LB-05, LB-09, LB-19). It writes nothing and starts nothing; the only
// Docker calls are read-only listings, made with an argument array. Run it with
// `node --test scripts/load/check/smoke-summary.check.mjs`. It is not a `*.test.mjs`, so `pnpm test:harness` never runs it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DEFAULT_LIMITS } from '../lib/container-spec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = join(ROOT, 'reports', 'load');
const SMOKE_SUMMARY = join(REPORTS, 'smoke-summary.json');
const FULL_SUMMARY = join(REPORTS, 'summary.json');
const LOCK = join(os.tmpdir(), 'd2rmm-load.lock');
const LABEL = 'd2rmm-load';
const SECRET_TEXT = /cookie|bearer|password|passwd|d2rmm_a_|__host-|claimsecret|token/iu;
const VERSION_KEYS = ['k6', 'sseExtension', 'node', 'postgres', 'openssl', 'apiImage'];

const text = readFileSync(SMOKE_SUMMARY, 'utf8');
const summary = JSON.parse(text);
const [step] = summary.steps;

/** The labelled resources of one kind, listed read-only. `kind` is one of the three `docker` listings. */
function labelledOf(kind) {
  const listings = {
    containers: ['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}'],
    networks: ['network', 'ls', '--filter', `label=${LABEL}`, '--format', '{{.Name}}'],
    volumes: ['volume', 'ls', '--filter', `label=${LABEL}`, '--format', '{{.Name}}'],
  };
  return execFileSync('docker', listings[kind], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

test('the smoke summary is a passed smoke run with one step of 5 players', () => {
  assert.equal(summary.profile, 'smoke');
  assert.equal(summary.passed, true, 'the smoke run passed');
  assert.equal(summary.error, null, 'no tool error');
  assert.equal(summary.steps.length, 1, 'one step');
  assert.equal(step.players, 5, 'five players');
  assert.equal(step.passed, true, 'the step passed');
  assert.equal(step.failedRule, null);
});

test('the step measured latency, agents and bytes', () => {
  assert.equal(typeof step.latencyP95Ms, 'number', 'a p95 exists, so there are latency samples');
  assert.ok(step.latencyP95Ms > 0, 'the latency p95 is above 0 ms');
  assert.ok(step.latencyCount > 0, 'the latency samples are counted');
  assert.ok(step.agentAssignedFrames > 0, 'the agent stream received room.assigned frames');
  assert.ok(step.bytesReceived > 0, 'the meter counted the API bytes to the players');
  assert.ok(step.telemetryBytes > 0, 'the sink counted the telemetry bytes');
  assert.ok(step.windowSeconds > 0, 'the meter window has a length');
});

test('the limits are the defaults and every version is named', () => {
  assert.deepEqual(summary.limits, { ...DEFAULT_LIMITS }, 'the CPU and memory limits are the defaults');
  for (const key of VERSION_KEYS) {
    assert.equal(typeof summary.versions[key], 'string', `versions.${key} is named`);
    assert.notEqual(summary.versions[key].trim(), '', `versions.${key} is not empty`);
  }
  assert.match(summary.versions.openssl, /alpine\/openssl/u, 'the certificate image is named');
});

test('the accounting of the step holds', () => {
  assert.ok(step.matchesPosted >= step.iterationsStarted, 'no more iterations than matches posted');
  assert.ok(step.iterations >= 1, 'at least one iteration finished in the window');
  assert.ok(step.latencyCount >= 1, 'at least one iteration has a latency sample');
  const lost = Math.max(0, step.matchesPosted - step.iterationsStarted);
  const dropped = step.droppedIterations;
  assert.ok(Number.isInteger(dropped) && dropped >= 0, 'dropped arrivals are a count');
  // The row carries the step's total errors only: the k6 window errors are the rest after the lost assignments and the
  // dropped arrivals, which the orchestrator adds (error-ratio.mjs). The row does not hold them separately.
  const windowErrors = step.errors - lost - dropped;
  assert.ok(
    windowErrors >= 0,
    `the step errors (${step.errors}) cover the lost (${lost}) and dropped (${dropped})`,
  );
});

test('no cookie, token or password text reaches the summary', () => {
  assert.doesNotMatch(text, SECRET_TEXT);
});

test('the smoke run never writes summary.json', () => {
  if (!existsSync(FULL_SUMMARY)) return;
  const written = statSync(FULL_SUMMARY).mtimeMs;
  assert.ok(written < Date.parse(summary.startedAt), 'summary.json was not written by this run');
});

test('after the run nothing is left: no container, network, volume, work directory or lock', () => {
  assert.deepEqual(labelledOf('containers'), [], 'no labelled container');
  assert.deepEqual(labelledOf('networks'), [], 'no labelled network');
  assert.deepEqual(labelledOf('volumes'), [], 'no labelled volume');
  const leftovers = readdirSync(os.tmpdir()).filter((name) => name.startsWith('d2rmm-load-'));
  assert.deepEqual(leftovers, [], 'no work directory under the temporary directory');
  assert.equal(existsSync(LOCK), false, 'the run lock is released');
});
