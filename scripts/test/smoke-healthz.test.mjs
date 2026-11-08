// CFP-16 (ci-fast-path): the smoke script waits at most 30 seconds for GET /healthz to answer 200. The clock and the
// request are injected, so the rule is proved without a server or real waiting.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForHealthz } from '../ci/smoke-healthz.mjs';

/** A fake clock: `sleep` advances `now`, so every wait is instant and exact. */
function fakeClock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms) => {
      elapsed += ms;
    },
  };
}

/** A fake fetch that answers 200 from `second` on, and 503 before it. It records each attempt's time. */
function answersFrom(second, clock) {
  const attempts = [];
  const request = async () => {
    attempts.push(clock.now());
    return { status: clock.now() >= second * 1000 ? 200 : 503 };
  };
  return { request, attempts };
}

test('waits at most 30 seconds for healthz', async () => {
  const at29 = fakeClock();
  const passesAt29 = answersFrom(29, at29);
  const resultAt29 = await waitForHealthz('http://api.test/healthz', {
    request: passesAt29.request,
    now: at29.now,
    sleep: at29.sleep,
  });
  assert.equal(resultAt29.ok, true, 'a 200 at 29 seconds passes');

  const at30 = fakeClock();
  const passesAt30 = answersFrom(30, at30);
  const resultAt30 = await waitForHealthz('http://api.test/healthz', {
    request: passesAt30.request,
    now: at30.now,
    sleep: at30.sleep,
  });
  assert.equal(resultAt30.ok, true, 'a 200 at 30 seconds passes');

  const at31 = fakeClock();
  const failsBy31 = answersFrom(31, at31);
  const resultAt31 = await waitForHealthz('http://api.test/healthz', {
    request: failsBy31.request,
    now: at31.now,
    sleep: at31.sleep,
  });
  assert.equal(resultAt31.ok, false, 'no 200 by 31 seconds fails');
  assert.equal(
    failsBy31.attempts.at(-1),
    30000,
    'the last attempt is at 30 seconds, and nothing waits past it',
  );
});

test('a connection that is refused counts as not answering yet', async () => {
  const clock = fakeClock();
  let calls = 0;
  const request = async () => {
    calls += 1;
    if (calls < 3) {
      throw new TypeError('fetch failed');
    }
    return { status: 200 };
  };
  const result = await waitForHealthz('http://api.test/healthz', {
    request,
    now: clock.now,
    sleep: clock.sleep,
  });
  assert.equal(result.ok, true, 'the third attempt answers 200');
  assert.equal(result.elapsedMs, 2000, 'the wait is one second per attempt');
});
