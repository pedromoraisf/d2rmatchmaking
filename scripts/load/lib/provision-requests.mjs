// The request builders of the provisioner (design.md § Provisioner; LB-03). Pure: each builder returns `{ url, init }` for
// the global `fetch`. Every URL has the host 127.0.0.1 (the meter's published port), so a provisioning request can reach
// nothing else. Headers follow the routes: `Origin` and `Content-Type` on the same-origin site routes, `X-Agent-Version` on
// the agent routes, `X-Forwarded-For` per player, the session cookie on `pair`, and no `Authorization` on a site call.

const LOOPBACK_HOST = '127.0.0.1';
const SESSION_COOKIE = '__Host-d2rmm_session';
const ADDRESS_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const NAME_PATTERN = /^[A-Za-z0-9]{2,16}$/;
const TOKEN_PATTERN = /^d2rmm_a_[^\s"',;]+$/;
const JSON_TYPE = 'application/json';

/** The origin of the meter's published port, which must be `http://127.0.0.1:<port>`. */
function originOf(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new TypeError('the base is not a URL');
  }
  if (url.protocol !== 'http:' || url.hostname !== LOOPBACK_HOST || url.port === '') {
    throw new TypeError(`the base must be http://${LOOPBACK_HOST}:<port>`);
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('the base is the origin only, with no path, query, fragment or user info');
  }
  return url.origin;
}

function addressOf(address) {
  const match = ADDRESS_PATTERN.exec(String(address));
  if (!match || match.slice(1).some((octet) => Number(octet) > 255)) {
    throw new TypeError('a player address is an IPv4 address');
  }
  return address;
}

function versionOf(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new TypeError('the agent version is a semantic version');
  }
  return version;
}

function nameOf(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new TypeError('a player name is 2 to 16 letters and digits');
  }
  return name;
}

function request(base, path, method, headers, body) {
  return {
    url: `${originOf(base)}${path}`,
    init: { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  };
}

/** `POST /v1/auth/test-login`: signs a player in. A same-origin site call with a JSON body. */
export function testLoginRequest({ base, origin, address, name }) {
  return request(
    base,
    '/v1/auth/test-login',
    'POST',
    { Origin: origin, 'Content-Type': JSON_TYPE, 'X-Forwarded-For': addressOf(address) },
    { name: nameOf(name) },
  );
}

/** `POST /v1/agents/pairing-codes`: a new pairing code for the agent. An agent route, no body. */
export function pairingCodeRequest({ base, version, address }) {
  return request(base, '/v1/agents/pairing-codes', 'POST', {
    'X-Agent-Version': versionOf(version),
    'X-Forwarded-For': addressOf(address),
  });
}

/** `POST /v1/agents/pair`: the signed-in player pairs the code. A same-origin site call with its session cookie. */
export function pairRequest({ base, origin, address, cookie, code }) {
  if (typeof cookie !== 'string' || !cookie.startsWith(`${SESSION_COOKIE}=`)) {
    throw new TypeError('the pair call carries the session cookie');
  }
  return request(
    base,
    '/v1/agents/pair',
    'POST',
    {
      Origin: origin,
      'Content-Type': JSON_TYPE,
      Cookie: cookie,
      'X-Forwarded-For': addressOf(address),
    },
    { code: String(code) },
  );
}

/** `POST /v1/agents/pairing-codes/claim`: the one-time token, polled until 200. An agent route with the claim secret. */
export function claimRequest({ base, version, address, claimSecret }) {
  return request(
    base,
    '/v1/agents/pairing-codes/claim',
    'POST',
    {
      'X-Agent-Version': versionOf(version),
      'Content-Type': JSON_TYPE,
      'X-Forwarded-For': addressOf(address),
    },
    { claimSecret: String(claimSecret) },
  );
}

/**
 * The session cookie pair of a `Set-Cookie` header: `__Host-d2rmm_session=<value>`, without its attributes.
 * @param {string | string[]} setCookie the header value, or the list of header values
 * @returns {string}
 */
export function cookieFrom(setCookie) {
  const text = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
  const match = /(?:^|[\n,]\s*)__Host-d2rmm_session=([^;,\s]+)/.exec(text);
  if (!match) {
    throw new TypeError('the answer set no session cookie');
  }
  return `${SESSION_COOKIE}=${match[1]}`;
}

/**
 * The agent token of a claim answer: the `d2rmm_a_` token.
 * @param {{ token?: unknown } | null | undefined} body the parsed body of a 200 claim answer
 * @returns {string}
 */
export function tokenFrom(body) {
  const token = body?.token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new TypeError('the claim answer carries no agent token');
  }
  return token;
}
