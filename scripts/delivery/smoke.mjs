// The `smoke` stage (ADR 033, DLP-04): wake the service with a backoff of up to 90 s, then check what answers. The rules
// take their clock and request as arguments, so the tests wait for nothing. The CLI is what stage-smoke.yml calls.
import { fileURLToPath } from 'node:url';

export const WAKE_BUDGET_MS = 90_000;
/** Never fewer than 5 s between two requests, so the smoke cannot trip the host's rate limiting. */
const FIRST_DELAY_MS = 5_000;
const LONGEST_DELAY_MS = 10_000;

/** The wait before retry `attempt` (0 first): 5 s, growing by half, never over 10 s (before jitter). */
export function backoffMs(attempt) {
  return Math.min(LONGEST_DELAY_MS, Math.round(FIRST_DELAY_MS * 1.5 ** attempt));
}

/** `delayMs` plus up to 25 % (`random` in `[0, 1)`): jitter only lengthens a wait, so the 5 s floor holds. */
export function jitteredMs(delayMs, random) {
  return Math.round(delayMs * (1 + 0.25 * random()));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests `url` until `accept(response)` holds or the budget is spent. Returns `{ ok, response, waitedMs, attempts }`;
 * a request that throws counts as "asleep". The total wait never exceeds `budgetMs`, and two requests are always
 * at least 5 s apart.
 */
export async function wakeAndRead(
  url,
  { request, accept, budgetMs = WAKE_BUDGET_MS, wait = sleep, timeoutMs = 15_000, random = Math.random },
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
    const delay = jitteredMs(backoffMs(attempts - 1), random);
    // A wait that would pass the budget is not taken: the last answer is the result, and no request comes sooner than 5 s.
    if (waitedMs + delay > budgetMs) return { ok: false, response, waitedMs, attempts };
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
async function describe(result) {
  if (result.response === undefined) return 'no answer';
  let body;
  try {
    body = (await result.response.text()).slice(0, 200).replace(/\s+/g, ' ');
  } catch {
    body = '';
  }
  const headers = ['server', 'cf-ray', 'cf-mitigated', 'x-render-routing']
    .map((name) => `${name}=${result.response.headers?.get?.(name) ?? '-'}`)
    .join(' ');
  const challenged =
    result.response.status === 429 && (result.response.headers?.get?.('cf-mitigated') ?? null) !== null;
  const verdict = challenged ? 'the API host challenged the request (Render edge), not a sleeping API; ' : '';
  return `${verdict}last answer ${result.response.status} [${headers}] ${body}`;
}

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
    if (!page.ok) failures.push(`the page ${base}/ did not answer 200 HTML (${await describe(page)})`);
    const api = await wakeAndRead(`${base}/api/healthz`, { ...asks, accept: (r) => healthzAccepts(r) });
    if (!api.ok)
      failures.push(
        `${base}/api/healthz did not answer ok within ${WAKE_BUDGET_MS / 1000} s (${await describe(api)})`,
      );
  } else if (app === 'api') {
    const health = await wakeAndRead(`${base}/healthz`, { ...asks, accept: (r) => healthzAccepts(r, sha) });
    if (!health.ok)
      failures.push(`${base}/healthz did not answer ok with version ${sha} (${await describe(health)})`);
  } else {
    failures.push(`no smoke checks for app "${app}"`);
  }
  return failures;
}

/** The longest wait the deploy stage allows (a Render build takes minutes), from `SMOKE_BUDGET_SECONDS`; else undefined. */
export function budgetFromEnv(value) {
  const seconds = /^[0-9]{1,3}$/.test(String(value ?? '')) ? Number(value) : 0;
  return seconds >= 1 && seconds <= 900 ? seconds * 1000 : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `smoke.mjs <app> <url> <sha>`
  const [app, url, rawSha] = process.argv.slice(2);
  // An empty SHA means "any build": an agent smoke only needs the API awake.
  const sha = rawSha === '' ? undefined : rawSha;
  const budgetMs = budgetFromEnv(process.env.SMOKE_BUDGET_SECONDS);
  const failures = await smokeChecks(app, url, sha, {
    ...(budgetMs === undefined ? {} : { budgetMs }),
    request: (u, signal) => fetch(u, { signal, headers: { 'user-agent': 'd2rmm-delivery-smoke' } }),
  });
  for (const failure of failures) process.stderr.write(`::error::${failure}\n`);
  if (failures.length > 0) process.exit(1);
  process.stdout.write(`smoke passed for ${app} at ${url}\n`);
}
