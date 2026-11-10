// Smoke check for the API booted in CI (CFP-15, CFP-16): requests the URL once a second until it answers 200. It exits 1
// when 30 seconds pass without a 200. Usage: node scripts/ci/smoke-healthz.mjs <url>
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const DEADLINE_MS = 30_000;
const INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** True when one request answers 200. A refused or timed-out connection is not an answer yet. */
async function answersOk(url, request) {
  try {
    const response = await request(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Polls `url` until it answers 200 or the deadline passes. The attempts run at 0, 1, … 30 seconds, so a 200 at 30
 * seconds still passes. Returns `{ ok, elapsedMs }`.
 */
export async function waitForHealthz(
  url,
  { request, now, sleep, deadlineMs = DEADLINE_MS, intervalMs = INTERVAL_MS },
) {
  const start = now();
  for (;;) {
    if (await answersOk(url, request)) {
      return { ok: true, elapsedMs: now() - start };
    }
    const elapsedMs = now() - start;
    if (elapsedMs >= deadlineMs) {
      return { ok: false, elapsedMs };
    }
    await sleep(intervalMs);
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const url = process.argv[2];
  if (url === undefined) {
    process.stderr.write('usage: node scripts/ci/smoke-healthz.mjs <url>\n');
    process.exit(2);
  }
  const result = await waitForHealthz(url, {
    request: (target, init) => fetch(target, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (!result.ok) {
    process.stderr.write(`smoke: GET ${url} did not answer 200 within 30 seconds\n`);
    process.exit(1);
  }
  process.stdout.write(`smoke: GET ${url} answered 200 after ${Math.round(result.elapsedMs / 1000)} s\n`);
}
