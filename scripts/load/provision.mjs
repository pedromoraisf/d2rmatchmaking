// The provisioner of the load run (design.md § Provisioner; LB-03, LB-04). It signs each player in, requests a pairing code,
// pairs it with the player's session cookie and claims the agent token, polling the claim while it answers 202 `pending`.
// It runs at most PROVISION_CONCURRENCY players at a time and only talks to the `fetch` it is given (the meter's published
// port on 127.0.0.1). Nothing it logs or throws carries a cookie, a token or a claim secret: every error names the step and
// the player's index, and the message is redacted before it is thrown.

import { setTimeout as delay } from 'node:timers/promises';
import {
  claimRequest,
  cookieFrom,
  pairRequest,
  pairingCodeRequest,
  testLoginRequest,
  tokenFrom,
} from './lib/provision-requests.mjs';
import { redact } from './lib/redact.mjs';

export const PROVISION_CONCURRENCY = 20;
const CLAIM_POLLS = 60;
const CLAIM_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 10_000;

/** A provisioning failure. The message names the step and the player's index and never carries a secret. */
export class ProvisionError extends Error {
  constructor(message) {
    super(redact(message));
    this.name = 'ProvisionError';
  }
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
 * }} input
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
}) {
  if (!Array.isArray(players)) {
    throw new TypeError('provision takes the players as an array');
  }
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
          fetchPort,
          pollMs,
          maxPolls,
        }),
      ),
    );
    provisioned.push(...done);
  }
  return provisioned;
}

async function provisionOne({ player, index, base, origin, version, fetchPort, pollMs, maxPolls }) {
  const login = await send(
    fetchPort,
    testLoginRequest({ base, origin, address: player.address, name: player.name }),
  );
  if (!isSuccess(login)) throw failure('test-login', index, login);
  const cookie = cookieFrom(setCookiesOf(login));

  const issued = await send(fetchPort, pairingCodeRequest({ base, version, address: player.address }));
  if (issued.status !== 201) throw failure('pairing-codes', index, issued);
  const { code, claimSecret } = codeAndSecretOf(issued, index);

  const paired = await send(fetchPort, pairRequest({ base, origin, address: player.address, cookie, code }));
  if (!isSuccess(paired)) throw failure('pair', index, paired);

  const token = await claimToken({
    base,
    version,
    address: player.address,
    claimSecret,
    index,
    fetchPort,
    pollMs,
    maxPolls,
  });
  return { name: player.name, address: player.address, cookie, token };
}

async function claimToken({ base, version, address, claimSecret, index, fetchPort, pollMs, maxPolls }) {
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const claim = await send(fetchPort, claimRequest({ base, version, address, claimSecret }));
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

/** Sends one built request. Resolves with the status, the headers and the parsed JSON body (undefined when there is none). */
async function send(fetchPort, { url, init }) {
  const response = await fetchPort(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: parsedOf(text) };
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

function failure(step, index, answer) {
  return new ProvisionError(`${step} of player ${index} answered ${answer.status}`);
}
