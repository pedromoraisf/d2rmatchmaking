// The `smoke` stage (ADR 033, DLP-04): wake the service with a backoff of up to 90 s, then check what answers. The rules
// take their clock and request as arguments, so the tests wait for nothing. The CLI is what stage-smoke.yml calls.
import { fileURLToPath } from 'node:url';

export const WAKE_BUDGET_MS = 90_000;
const FIRST_DELAY_MS = 2_000;
const LONGEST_DELAY_MS = 10_000;

/** The wait before retry `attempt` (0 first): 2 s, growing by half, never over 10 s. */
export function backoffMs(attempt) {
  return Math.min(LONGEST_DELAY_MS, Math.round(FIRST_DELAY_MS * 1.5 ** attempt));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests `url` until `accept(response)` holds or the budget is spent. Returns `{ ok, response, waitedMs, attempts }`;
 * a request that throws counts as "asleep". The total wait never exceeds `budgetMs`.
 */
export async function wakeAndRead(
  url,
  { request, accept, budgetMs = WAKE_BUDGET_MS, wait = sleep, timeoutMs = 15_000 },
) {
  let waitedMs = 0;
  for (let attempts = 1; ; attempts += 1) {
    let response;
    try {
      response = await request(url, AbortSignal.timeout(timeoutMs));
    } catch {
      response = undefined;
    }
    if (response !== undefined && (await accept(response))) return { ok: true, response, waitedMs, attempts };
    if (waitedMs >= budgetMs) return { ok: false, response, waitedMs, attempts };
    const delay = Math.min(backoffMs(attempts - 1), budgetMs - waitedMs);
    waitedMs += delay;
    await wait(delay);
  }
}

/** The check of `/healthz`: 200 with `status: "ok"`, and, when `expectedSha` is given, that exact `version`. */
export async function healthzAccepts(response, expectedSha) {
  if (response.status !== 200) return false;
  try {
    const body = await response.json();
    return body?.status === 'ok' && (expectedSha === undefined || body?.version === expectedSha);
  } catch {
    return false;
  }
}

/**
 * The checks of one app. `site`: the page answers 200 with an HTML body, then the API behind its proxy answers
 * `/api/healthz` ok. `api`: `/healthz` answers the deployed SHA. Returns a list of failure messages (empty = pass).
 */
export async function smokeChecks(app, url, sha, io) {
  const base = url.replace(/\/+$/, '');
  const failures = [];
  const asks = {
    request: io.request,
    wait: io.wait,
    ...(io.budgetMs === undefined ? {} : { budgetMs: io.budgetMs }),
  };
  if (app === 'site') {
    const page = await wakeAndRead(`${base}/`, {
      ...asks,
      accept: async (r) => r.status === 200 && /text\/html/.test(r.headers.get('content-type') ?? ''),
    });
    if (!page.ok) failures.push(`the page ${base}/ did not answer 200 HTML`);
    const api = await wakeAndRead(`${base}/api/healthz`, { ...asks, accept: (r) => healthzAccepts(r) });
    if (!api.ok) failures.push(`${base}/api/healthz did not answer ok within ${WAKE_BUDGET_MS / 1000} s`);
  } else if (app === 'api') {
    const health = await wakeAndRead(`${base}/healthz`, { ...asks, accept: (r) => healthzAccepts(r, sha) });
    if (!health.ok) failures.push(`${base}/healthz did not answer ok with version ${sha}`);
  } else {
    failures.push(`no smoke checks for app "${app}"`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `smoke.mjs <app> <url> <sha>`
  const [app, url, sha] = process.argv.slice(2);
  const failures = await smokeChecks(app, url, sha, { request: (u, signal) => fetch(u, { signal }) });
  for (const failure of failures) process.stderr.write(`::error::${failure}\n`);
  if (failures.length > 0) process.exit(1);
  process.stdout.write(`smoke passed for ${app} at ${url}\n`);
}
