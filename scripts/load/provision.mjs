// The provisioner of the load run (design.md § Provisioner; LB-03, LB-04, LB-12). It signs each player in, requests a pairing
// code, pairs it with the player's session cookie and claims the agent token, polling the claim while it answers 202 `pending`.
// It runs at most PROVISION_CONCURRENCY players at a time and only talks to the `fetch` it is given (the meter's published
// port on 127.0.0.1). Nothing it logs or throws carries a cookie, a token or a claim secret: every failed request names its
// route, the player's index, its kind (`timeout`, `status:<code>`, `network`) and its elapsed milliseconds, and the message is
// redacted before it is thrown. It also keeps the slowest request time of each route, so slowness shows before a timeout.

import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import {
  claimRequest,
  cookieFrom,
  pairRequest,
  pairingCodeRequest,
  PROVISION_ROUTES,
  testLoginRequest,
  tokenFrom,
} from './lib/provision-requests.mjs';
import { redact } from './lib/redact.mjs';

export const PROVISION_CONCURRENCY = 20;
const CLAIM_POLLS = 60;
const CLAIM_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 10_000;

/** A provisioning failure. The message names the route, the player's index and the kind, and never carries a secret. */
export class ProvisionError extends Error {
  constructor(message) {
    super(redact(message));
    this.name = 'ProvisionError';
  }
}

/** The slowest request time of each route, in whole milliseconds; zero for a route that has had no request. */
export function emptyTimings() {
  return Object.fromEntries(PROVISION_ROUTES.map((route) => [route, 0]));
}

/**
 * Provisions the given players: each one ends with its session cookie and its agent token.
 * @param {{
 *   players: { name: string, address: string }[],
 *   base: string,
 *   origin: string,
 *   version: string,
 *   fetch?: (url: string, init: object) => Promise<Response>,
 *   pollMs?: number,
 *   maxPolls?: number,
 *   now?: () => number,
 *   timings?: Record<string, number>,
 * }} input `now` reads a clock in milliseconds and `timings` receives the slowest request time of each route (kept
 *   with the larger value, so a caller may pass the same object to several calls); both default to the real clock.
 * @returns {Promise<{ name: string, address: string, cookie: string, token: string }[]>}
 */
export async function provision({
  players,
  base,
  origin,
  version,
  fetch: fetchPort = globalThis.fetch,
  pollMs = CLAIM_INTERVAL_MS,
  maxPolls = CLAIM_POLLS,
  now = () => performance.now(),
  timings = emptyTimings(),
}) {
  if (!Array.isArray(players)) {
    throw new TypeError('provision takes the players as an array');
  }
  const port = { fetchPort, now, timings };
  const provisioned = [];
  for (let offset = 0; offset < players.length; offset += PROVISION_CONCURRENCY) {
    const chunk = players.slice(offset, offset + PROVISION_CONCURRENCY);
    const done = await Promise.all(
      chunk.map((player, position) =>
        provisionOne({
          player,
          index: offset + position,
          base,
          origin,
          version,
          pollMs,
          maxPolls,
          port,
        }),
      ),
    );
    provisioned.push(...done);
  }
  return provisioned;
}

async function provisionOne({ player, index, base, origin, version, pollMs, maxPolls, port }) {
  const login = await send(
    port,
    index,
    'test-login',
    testLoginRequest({ base, origin, address: player.address, name: player.name }),
  );
  if (!isSuccess(login)) throw failure('test-login', index, login);
  const cookie = cookieFrom(setCookiesOf(login));

  const issued = await send(
    port,
    index,
    'pairing-codes',
    pairingCodeRequest({ base, version, address: player.address }),
  );
  if (issued.status !== 201) throw failure('pairing-codes', index, issued);
  const { code, claimSecret } = codeAndSecretOf(issued, index);

  const paired = await send(
    port,
    index,
    'pair',
    pairRequest({ base, origin, address: player.address, cookie, code }),
  );
  if (!isSuccess(paired)) throw failure('pair', index, paired);

  const token = await claimToken({
    base,
    version,
    address: player.address,
    claimSecret,
    index,
    port,
    pollMs,
    maxPolls,
  });
  return { name: player.name, address: player.address, cookie, token };
}

async function claimToken({ base, version, address, claimSecret, index, port, pollMs, maxPolls }) {
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const claim = await send(port, index, 'claim', claimRequest({ base, version, address, claimSecret }));
    if (claim.status === 200) return tokenFromBody(claim, index);
    if (claim.status !== 202) throw failure('claim', index, claim);
    if (poll < maxPolls) await delay(pollMs);
  }
  throw new ProvisionError(`the claim of player ${index} stayed pending after ${maxPolls} polls`);
}

function tokenFromBody(answer, index) {
  try {
    return tokenFrom(answer.body);
  } catch {
    throw new ProvisionError(`the claim of player ${index} answered without an agent token`);
  }
}

function codeAndSecretOf(answer, index) {
  const body = answer.body;
  if (typeof body?.code !== 'string' || typeof body?.claimSecret !== 'string') {
    throw new ProvisionError(`pairing-codes of player ${index} answered without a code and a claim secret`);
  }
  return body;
}

/**
 * Sends one built request and records its elapsed time under its route, keeping the slowest. Resolves with the status, the
 * headers, the parsed JSON body (undefined when there is none) and the elapsed milliseconds. A request that gets no answer
 * (a timeout or a network error) throws a ProvisionError that names its route, its player and its kind.
 */
async function send(port, index, route, { url, init }) {
  const started = port.now();
  let response;
  let text;
  try {
    response = await port.fetchPort(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    text = await response.text();
  } catch (error) {
    const ms = recordOf(port, route, started);
    throw new ProvisionError(
      `${route} of player ${index} did not answer (kind ${kindOfTransport(error)}, ${ms} ms): ${messageOf(error)}`,
    );
  }
  const ms = recordOf(port, route, started);
  return { status: response.status, headers: response.headers, body: parsedOf(text), ms };
}

/** The elapsed milliseconds of one request, kept as the route's slowest time when it is the larger. */
function recordOf(port, route, started) {
  const ms = Math.round(port.now() - started);
  port.timings[route] = Math.max(port.timings[route], ms);
  return ms;
}

/** A request that AbortSignal.timeout ended is a `timeout`; any other failure to get an answer is a `network` failure. */
function kindOfTransport(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
}

function messageOf(error) {
  return typeof error?.message === 'string' ? error.message : String(error);
}

function parsedOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isSuccess(answer) {
  return answer.status >= 200 && answer.status <= 299;
}

function setCookiesOf(answer) {
  const headers = answer.headers;
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  return headers.get('set-cookie') ?? '';
}

function failure(route, index, answer) {
  return new ProvisionError(
    `${route} of player ${index} answered ${answer.status} (kind status:${answer.status}, ${answer.ms} ms)`,
  );
}
