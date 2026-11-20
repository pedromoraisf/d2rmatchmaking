// Unit tests of the delivery scripts (ADR 033): Pages branch rule (DLP-08), the verify verdict, the promote gate and the
// smoke wake. Clocks and requests are injected: nothing here waits or touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagesBranchFor, PHASE_PREVIEW_BRANCH } from '../delivery/pages.mjs';
import { verdictOf, waitForVerdict } from '../delivery/ci-verdict.mjs';
import { isSmokeJob, stagingSmokeRunId } from '../delivery/promotable.mjs';
import {
  backoffMs,
  healthzAccepts,
  jitteredMs,
  smokeChecks,
  wakeAndRead,
  WAKE_BUDGET_MS,
} from '../delivery/smoke.mjs';
import { previewConfigJson, previewSiteOrigin } from '../preview/preview.mjs';

test('every phase branch deploys to the one fixed alias, so one redirect URL is registered (DLP-08)', () => {
  assert.equal(PHASE_PREVIEW_BRANCH, 'phase-preview');
  assert.equal(pagesBranchFor('preview', 'phase/F2'), 'phase-preview');
  assert.equal(pagesBranchFor('preview', 'phase/F3'), 'phase-preview');
  assert.equal(
    previewSiteOrigin(pagesBranchFor('preview', 'phase/F2'), 'd2rmm'),
    'https://phase-preview.d2rmm.pages.dev',
  );
});

test('other previews keep their branch alias; staging and production have fixed branches', () => {
  assert.equal(pagesBranchFor('preview', 'feat/F2-delivery-platform'), 'feat/F2-delivery-platform');
  assert.equal(pagesBranchFor('staging', 'main'), 'staging');
  assert.equal(pagesBranchFor('production', 'main'), 'main');
  assert.throws(() => pagesBranchFor('preview', 'feat/' + 'x'.repeat(40)), /no usable Pages alias/);
  assert.throws(() => pagesBranchFor('preview', ''), /no usable Pages alias/);
  assert.throws(() => pagesBranchFor('qa', 'main'), /unknown environment/);
  assert.notEqual(pagesBranchFor('preview', 'phase/F2/x'), 'phase-preview');
});

test('the preview configuration names a valid preview API origin or null', () => {
  assert.deepEqual(JSON.parse(previewConfigJson('https://d2rmm-api-pr-9.onrender.com')), {
    previewApiOrigin: 'https://d2rmm-api-pr-9.onrender.com',
  });
  assert.deepEqual(JSON.parse(previewConfigJson(undefined)), { previewApiOrigin: null });
  assert.deepEqual(JSON.parse(previewConfigJson('https://evil.example.com')), { previewApiOrigin: null });
});

test('verify: pass only on a finished green ci run; an absent run passes only when it is not required', () => {
  const done = (conclusion) => ({ status: 'completed', conclusion });
  assert.equal(verdictOf([done('success')], { required: true }), 'pass');
  assert.equal(verdictOf([done('failure')], { required: true }), 'fail');
  assert.equal(verdictOf([done('cancelled')], { required: false }), 'fail');
  assert.equal(verdictOf([{ status: 'in_progress', conclusion: null }], { required: true }), 'wait');
  assert.equal(verdictOf([], { required: true }), 'absent');
  assert.equal(verdictOf([], { required: false }), 'pass');
  assert.equal(
    verdictOf([done('success'), done('failure')], { required: true }),
    'pass',
    'the newest run decides',
  );
});

test('verify waits for a running ci within its budget and stops at the budget', async () => {
  let t = 0;
  const wait = async (ms) => {
    t += ms;
  };
  const answers = [
    [{ status: 'queued' }],
    [{ status: 'in_progress' }],
    [{ status: 'completed', conclusion: 'success' }],
  ];
  const ok = await waitForVerdict(async () => answers.shift(), {
    required: true,
    budgetMs: 100,
    intervalMs: 10,
    now: () => t,
    wait,
  });
  assert.equal(ok, 'pass');
  assert.equal(t, 20);
  t = 0;
  const stuck = await waitForVerdict(async () => [{ status: 'in_progress' }], {
    required: true,
    budgetMs: 100,
    intervalMs: 30,
    now: () => t,
    wait,
  });
  assert.equal(stuck, 'wait');
  assert.ok(t <= 100);
});

const SHA = 'a'.repeat(40);
const run = (over) => ({
  id: 1,
  head_sha: SHA,
  head_branch: 'main',
  event: 'push',
  conclusion: 'success',
  ...over,
});
const jobsWith =
  (...jobs) =>
  () =>
    jobs;

test('promote gate: needs a successful staging run of that SHA whose smoke job succeeded', () => {
  const smokeOk = { name: 'smoke / smoke', conclusion: 'success' };
  assert.equal(stagingSmokeRunId([run({ id: 7 })], SHA, jobsWith(smokeOk)), 7);
  assert.equal(stagingSmokeRunId([run()], SHA, jobsWith({ name: 'smoke', conclusion: 'success' })), 1);
});

test('promote gate refuses a failed or skipped smoke, another SHA, a PR run, a non-main push and a malformed SHA', () => {
  const smokeOk = { name: 'smoke / smoke', conclusion: 'success' };
  assert.equal(
    stagingSmokeRunId([run()], SHA, jobsWith({ name: 'smoke / smoke', conclusion: 'failure' })),
    undefined,
  );
  assert.equal(
    stagingSmokeRunId([run()], SHA, jobsWith({ name: 'smoke / smoke', conclusion: 'skipped' })),
    undefined,
  );
  assert.equal(
    stagingSmokeRunId([run()], SHA, jobsWith({ name: 'deploy / deploy', conclusion: 'success' })),
    undefined,
  );
  assert.equal(stagingSmokeRunId([run({ head_sha: 'b'.repeat(40) })], SHA, jobsWith(smokeOk)), undefined);
  assert.equal(stagingSmokeRunId([run({ event: 'pull_request' })], SHA, jobsWith(smokeOk)), undefined);
  assert.equal(stagingSmokeRunId([run({ head_branch: 'feat/x' })], SHA, jobsWith(smokeOk)), undefined);
  assert.equal(stagingSmokeRunId([run({ conclusion: 'failure' })], SHA, jobsWith(smokeOk)), undefined);
  assert.equal(stagingSmokeRunId([run()], 'abc', jobsWith(smokeOk)), undefined);
  assert.equal(stagingSmokeRunId([], SHA, jobsWith(smokeOk)), undefined);
  assert.equal(isSmokeJob({ name: 'smoke / smoke / extra' }), false);
});

test('smoke backoff: 5 s growing by half, never over 10 s; jitter only lengthens, by up to 25 %', () => {
  assert.deepEqual([0, 1, 2, 3, 8].map(backoffMs), [5000, 7500, 10000, 10000, 10000]);
  assert.equal(
    jitteredMs(5000, () => 0),
    5000,
  );
  assert.equal(
    jitteredMs(5000, () => 0.999999),
    6250,
  );
});

test('the wake never waits past 90 s and never asks twice within 5 s', async () => {
  const slept = [];
  const randoms = [0, 0.5, 0.999999];
  let i = 0;
  const result = await wakeAndRead('https://x.test/', {
    request: async () => ({ status: 502 }),
    accept: async () => false,
    wait: async (ms) => slept.push(ms),
    random: () => randoms[i++ % 3],
  });
  assert.equal(result.ok, false);
  assert.ok(
    slept.every((ms) => ms >= 5000),
    'no wait under 5 s',
  );
  const total = slept.reduce((a, b) => a + b, 0);
  assert.ok(total <= WAKE_BUDGET_MS, `waited ${total} ms`);
  assert.ok(WAKE_BUDGET_MS - total < 12500, 'the budget is used up to one more wait');
  assert.equal(result.waitedMs, total);
  assert.equal(result.attempts, slept.length + 1);
});

test('smoke wake returns as soon as the service answers, treating a thrown request as asleep', async () => {
  const answers = [new Error('reset'), { status: 502 }, { status: 200 }];
  const result = await wakeAndRead('https://x.test/', {
    request: async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    accept: async (r) => r.status === 200,
    wait: async () => {},
    random: () => 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.waitedMs, 12500);
});

test('a 429 with cf-mitigated is reported as the host challenging, not as a sleeping API', async () => {
  const challenged = {
    status: 429,
    headers: new Headers({ 'cf-mitigated': 'challenge', server: 'cloudflare' }),
    text: async () => '<title>Just a moment...</title>',
  };
  const failures = await smokeChecks('api', 'https://api.test', SHA, {
    request: async () => challenged,
    wait: async () => {},
    budgetMs: 0,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /the API host challenged the request \(Render edge\), not a sleeping API/);
  const plain = await smokeChecks('api', 'https://api.test', SHA, {
    request: async () => ({ status: 502, headers: new Headers(), text: async () => 'bad gateway' }),
    wait: async () => {},
    budgetMs: 0,
  });
  assert.doesNotMatch(plain[0], /challenged/);
});

const json = (body, status = 200) => ({ status, json: async () => body });

test('healthz is accepted only when ok, and, if a SHA is expected, only for that SHA', async () => {
  assert.equal(await healthzAccepts(json({ status: 'ok', version: SHA })), true);
  assert.equal(await healthzAccepts(json({ status: 'ok', version: SHA }), SHA), true);
  assert.equal(await healthzAccepts(json({ status: 'ok', version: 'unknown' }), SHA), false);
  assert.equal(await healthzAccepts(json({ status: 'ok', version: SHA }, 502), SHA), false);
  assert.equal(
    await healthzAccepts({
      status: 200,
      json: async () => {
        throw new Error('html');
      },
    }),
    false,
  );
});

test('the api smoke fails when another build answers; the site smoke needs the page and the API behind it', async () => {
  const io = (version, html = true) => ({
    wait: async () => {},
    budgetMs: 0,
    request: async (url) =>
      url.endsWith('/')
        ? { status: 200, headers: new Headers({ 'content-type': html ? 'text/html' : 'text/plain' }) }
        : json({ status: 'ok', version }),
  });
  assert.deepEqual(await smokeChecks('api', 'https://api.test', SHA, io(SHA)), []);
  assert.equal((await smokeChecks('api', 'https://api.test', SHA, io('f'.repeat(40)))).length, 1);
  assert.deepEqual(await smokeChecks('site', 'https://s.test/', undefined, io('unknown')), []);
  assert.equal((await smokeChecks('site', 'https://s.test', undefined, io('unknown', false))).length, 1);
  assert.equal((await smokeChecks('agent', 'https://s.test', SHA, io(SHA))).length, 1);
});
