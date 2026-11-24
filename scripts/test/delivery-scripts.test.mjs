// Unit tests of the delivery scripts (ADR 033): Pages branch rule (DLP-08), the verify verdict, the promote gate and the
// smoke wake. Clocks and requests are injected: nothing here waits or touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentUrl } from '../delivery/deployment-url.mjs';
import { pagesBranchFor, PHASE_PREVIEW_BRANCH } from '../delivery/pages.mjs';
import { verdictOf, waitForVerdict } from '../delivery/ci-verdict.mjs';
import { isSmokeJob, stagingSmokeRunId } from '../delivery/promotable.mjs';
import {
  backoffMs,
  budgetFromEnv,
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

test('a preview may not take a reserved Pages name, by its raw name or by its alias', () => {
  for (const branch of [
    'main',
    'staging',
    'production',
    'phase-preview',
    'Main',
    'STAGING',
    'main!',
    '-staging-',
    'staging/',
    'phase_preview',
  ]) {
    assert.throws(() => pagesBranchFor('preview', branch), /reserved Pages name/, branch);
  }
  // The phase alias is reached only through a phase/* branch, and look-alikes stay ordinary previews.
  assert.equal(pagesBranchFor('preview', 'phase/F2'), 'phase-preview');
  assert.equal(pagesBranchFor('preview', 'main-fix'), 'main-fix');
  assert.equal(pagesBranchFor('preview', 'feat/staging'), 'feat/staging');
  // Staging and production themselves are not previews, so they are not refused.
  assert.equal(pagesBranchFor('staging', 'main'), 'staging');
  assert.equal(pagesBranchFor('production', 'main'), 'main');
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
      url.endsWith('/') || url.endsWith('/code-signing')
        ? { status: 200, headers: new Headers({ 'content-type': html ? 'text/html' : 'text/plain' }) }
        : json({ status: 'ok', version }),
  });
  assert.deepEqual(await smokeChecks('api', 'https://api.test', SHA, io(SHA)), []);
  assert.equal((await smokeChecks('api', 'https://api.test', SHA, io('f'.repeat(40)))).length, 1);
  assert.deepEqual(await smokeChecks('site', 'https://s.test/', undefined, io('unknown')), []);
  // A site that answers no HTML fails both the page and the code signing policy page (AGR-08).
  assert.equal((await smokeChecks('site', 'https://s.test', undefined, io('unknown', false))).length, 2);
  assert.equal((await smokeChecks('desktop', 'https://s.test', SHA, io(SHA))).length, 1);
});

test('an agent smoke needs only the API awake: /healthz ok for any build, and a URL to ask', async () => {
  const answer = (status, body) => async () => ({
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const io = (request) => ({ request, wait: async () => {}, budgetMs: 0 });
  const asked = [];
  const ok = answer(200, { status: 'ok', version: 'unknown' });
  assert.deepEqual(
    await smokeChecks('agent', 'https://api.test/', undefined, {
      ...io(async (url, signal) => (asked.push(url), ok(url, signal))),
    }),
    [],
  );
  assert.deepEqual(asked, ['https://api.test/healthz']);
  assert.deepEqual(await smokeChecks('agent', 'https://api.test', 'a'.repeat(40), io(ok)), []);
  assert.equal(
    (await smokeChecks('agent', 'https://api.test', undefined, io(answer(200, { status: 'down' })))).length,
    1,
    'a body that is not ok fails',
  );
  assert.equal(
    (await smokeChecks('agent', 'https://api.test', undefined, io(answer(503, { status: 'ok' })))).length,
    1,
    'a failing status fails',
  );
  assert.equal(
    (
      await smokeChecks(
        'agent',
        'https://api.test',
        undefined,
        io(async () => Promise.reject(new Error('x'))),
      )
    ).length,
    1,
    'an API that never answers fails',
  );
  let requests = 0;
  const failures = await smokeChecks(
    'agent',
    '',
    undefined,
    io(async () => (requests++, ok())),
  );
  assert.equal(failures.length, 1, 'an empty API base URL fails');
  assert.equal(requests, 0, 'without asking anything');
});

test('the site smoke also needs the code signing policy page to answer 200 HTML (AGR-08)', async () => {
  const html = { status: 200, headers: new Headers({ 'content-type': 'text/html' }) };
  const io = (policy) => ({
    wait: async () => {},
    budgetMs: 0,
    request: async (url) =>
      url.endsWith('/code-signing')
        ? policy
        : url.endsWith('/')
          ? html
          : { status: 200, json: async () => ({ status: 'ok', version: 'unknown' }) },
  });
  assert.deepEqual(await smokeChecks('site', 'https://s.test', undefined, io(html)), []);
  const missing = await smokeChecks(
    'site',
    'https://s.test',
    undefined,
    io({ status: 404, headers: new Headers(), text: async () => 'not found' }),
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0], /code signing policy https:\/\/s\.test\/code-signing did not answer 200 HTML/);
});

const WRANGLER = `
 ⛅️ wrangler 4.0.0
▲ [WARNING] See https://developers.cloudflare.com/pages/functions/ for more.
✨ Compiled Worker successfully
✨ Uploading Functions bundle
🌎 Deploying...
✨ Deployment complete! Take a peek over at https://1a2b3c4d.d2rmatchmaking.pages.dev
`;

test('the deployment URL is the project pages.dev host in wrangler output, not any other https link', () => {
  assert.equal(deploymentUrl(WRANGLER, 'd2rmatchmaking'), 'https://1a2b3c4d.d2rmatchmaking.pages.dev');
  assert.equal(
    deploymentUrl('see https://d2rmatchmaking.pages.dev.', 'd2rmatchmaking'),
    'https://d2rmatchmaking.pages.dev',
  );
  const both = `${WRANGLER}\nAlias: https://feat-x.d2rmatchmaking.pages.dev/\nDocs https://developers.cloudflare.com/pages/`;
  assert.equal(
    deploymentUrl(both, 'd2rmatchmaking'),
    'https://feat-x.d2rmatchmaking.pages.dev',
    'the last project URL wins',
  );
});

test('a URL on another project, another host or another scheme is not a deployment URL', () => {
  for (const output of [
    'https://developers.cloudflare.com/pages/',
    'https://1a2b.other-project.pages.dev',
    'https://evil.example.com/d2rmatchmaking.pages.dev',
    'https://d2rmatchmaking.pages.dev.evil.com',
    'https://a.b.d2rmatchmaking.pages.dev',
    'http://1a2b.d2rmatchmaking.pages.dev',
    '',
    undefined,
  ]) {
    assert.equal(deploymentUrl(output, 'd2rmatchmaking'), undefined, String(output));
  }
  assert.equal(deploymentUrl(WRANGLER, 'bad project'), undefined);
  assert.equal(deploymentUrl(WRANGLER, undefined), undefined);
});

test('the deploy stage may wait for a Render build for 1 to 900 seconds, set from the environment', () => {
  assert.equal(budgetFromEnv('600'), 600_000);
  assert.equal(budgetFromEnv('1'), 1000);
  assert.equal(budgetFromEnv('900'), 900_000);
  for (const bad of ['0', '901', '-5', '1e3', '', ' 60', 'abc', undefined, null]) {
    assert.equal(budgetFromEnv(bad), undefined, String(bad));
  }
});

test('an API smoke with no SHA accepts any build: an agent smoke only needs the API awake', async () => {
  const request = async () => ({
    status: 200,
    headers: new Headers(),
    json: async () => ({ status: 'ok', version: 'unknown' }),
  });
  assert.deepEqual(
    await smokeChecks('api', 'https://api.test', undefined, { request, wait: async () => {}, budgetMs: 0 }),
    [],
  );
});
