// The HTTP client of the bots (staging-bots SBT-05, SBT-08). One per run. It sends the headers each route needs (the site's
// session cookie and origin, the agent's bearer token and version), backs off on a 429 by `Retry-After`, and never prints a
// body or a header. The target is already checked by `assertStaging`: this client never decides where to send.

export class RateLimited extends Error {}

const MAX_TRIES = 4;
// A request can die before it is answered (a kept-alive socket the server has just closed): `fetch` throws and the request may
// never have reached the API. Every call the bots make is safe to send again (a login finds its account, a join answers 409,
// an observation carries its key), so a thrown request is sent again a few times before it fails.
const MAX_NETWORK_TRIES = 4;

export function createClient({ base, origin, version, fetch: send, sleep }) {
  async function sendAgain(url, init) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await send(url, init);
      } catch (error) {
        if (attempt >= MAX_NETWORK_TRIES) throw error;
        await sleep(200 * attempt);
      }
    }
  }

  async function call(path, { method = 'GET', headers = {}, body: given, noBackoff = false } = {}) {
    // Every non-GET route wants a JSON body (the same-origin guard): the site sends `{}` when it has nothing to say.
    const body = given === undefined && method !== 'GET' ? {} : given;
    for (let attempt = 1; ; attempt += 1) {
      const response = await sendAgain(`${base}${path}`, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
      });
      if (response.status !== 429) {
        const text = await response.text();
        let parsed;
        try {
          parsed = text === '' ? undefined : JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        return { status: response.status, body: parsed, headers: response.headers };
      }
      await response.body?.cancel().catch(() => undefined);
      if (noBackoff || attempt >= MAX_TRIES) {
        throw new RateLimited(`${method} ${path} answered 429`);
      }
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Math.min(Math.max(Number.isFinite(wait) && wait > 0 ? wait : 1, 1), 30) * 1000);
    }
  }
  const site = (path, cookie, options = {}) =>
    call(path, { ...options, headers: { Origin: origin, Cookie: cookie, ...options.headers } });
  const agent = (path, token, options = {}) =>
    call(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'X-Agent-Version': version, ...options.headers },
    });
  return { call, site, agent, version, origin };
}

/** The session cookie pair of a response's `Set-Cookie` headers. */
export function sessionCookieOf(headers) {
  const list =
    typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  const match = /(?:^|[\n,]\s*)(__Host-d2rmm_session=[^;,\s]+)/.exec(list.join('\n'));
  if (!match) throw new Error('the sign-in set no session cookie');
  return match[1];
}
