// The control surface and the argument rules of the two byte counters, the meter and the sink (design.md § Byte meter and
// sink; LB-14, LB-21). Both run the same endpoints: `POST /window/start`, `POST /window/stop` (answers `{ "bytes", "seconds" }`)
// and `GET /stats`. A request needs the run's bearer token and a `Host` header of `127.0.0.1:<port>`: a wrong host is `421`,
// a missing or wrong token is `401`, so a local process or a rebinding page cannot move a window. Nothing here logs. The
// token comes from a file (`--token-file`), never from a command-line value.

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const LOOPBACK = '127.0.0.1';
const TOKEN_PATTERN = /^[\x21-\x7e]{16,}$/;
const MAX_PORT = 65535;

/**
 * An address of the form `host:port`. Port 0 asks the system for a free port (used by the tests).
 * @param {string} text
 * @returns {{ host: string, port: number }}
 */
export function parseAddress(text) {
  const at = typeof text === 'string' ? text.lastIndexOf(':') : -1;
  const host = at > 0 ? text.slice(0, at) : '';
  const portText = at > 0 ? text.slice(at + 1) : '';
  if (host === '' || !/^\d+$/.test(portText) || Number(portText) > MAX_PORT) {
    throw new TypeError(`an address is host:port, got ${String(text)}`);
  }
  return { host, port: Number(portText) };
}

/**
 * The `--flag value` pairs of a container entry, keyed in camel case. Only the allowed flags are accepted: a token on the
 * command line is refused, because the token is read from `--token-file`.
 * @param {string[]} argv
 * @param {string[]} allowed the flag names, such as `--listen`
 * @returns {Record<string, string>}
 */
export function flagsOf(argv, allowed) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!allowed.includes(name)) {
      const hint = name === '--token' ? '; the token is read from --token-file' : '';
      throw new TypeError(`${String(name)} is not a flag of this container${hint}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new TypeError(`${name} takes a value`);
    const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key in flags) throw new TypeError(`${name} is given once`);
    flags[key] = value;
  }
  return flags;
}

/**
 * The run's bearer token from its file: one line of at least 16 printable characters without spaces. The error never
 * carries the token.
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function readToken(file) {
  const text = (await readFile(file, 'utf8')).trim();
  if (!TOKEN_PATTERN.test(text)) {
    throw new TypeError('the token file holds one token of at least 16 printable characters, with no spaces');
  }
  return text;
}

/**
 * Starts the control endpoints on `address`. `counter` is the window counter of the container; `stats` returns the plain
 * numbers `GET /stats` answers.
 * @param {{ address: string, token: string, counter: { start: () => void, stop: () => { bytes: number, seconds: number } },
 *   stats: () => object }} input
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startControl({ address, token, counter, stats }) {
  const { host, port } = parseAddress(address);
  const bearer = Buffer.from(`Bearer ${token}`);
  const server = createServer((request, response) => {
    request.resume();
    try {
      answer(request, response, { port: server.address().port, bearer, counter, stats });
    } catch {
      // An unexpected failure answers 500 and nothing else: the client is never left waiting, and nothing is logged.
      send(response, 500, { error: 'internal' });
    }
  });
  await listenOn(server, host, port);
  return {
    port: server.address().port,
    close: () => closeServer(server),
  };
}

/** The routing of the control endpoints: host first (421), then the bearer (401), then the route. */
function answer(request, response, { port, bearer, counter, stats }) {
  if (request.headers.host !== `${LOOPBACK}:${port}`) {
    return send(response, 421, { error: 'misdirected' });
  }
  if (!bearerMatches(request.headers.authorization, bearer)) {
    return send(response, 401, { error: 'unauthorized' });
  }
  const route = `${request.method} ${new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname}`;
  if (route === 'POST /window/start') {
    counter.start();
    return send(response, 200, { ok: true });
  }
  if (route === 'POST /window/stop') {
    const { bytes, seconds } = counter.stop();
    return send(response, 200, { bytes, seconds });
  }
  if (route === 'GET /stats') return send(response, 200, stats());
  return send(response, 404, { error: 'not-found' });
}

function bearerMatches(header, expected) {
  const given = Buffer.from(typeof header === 'string' ? header : '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

/** Listens on the host and port; resolves once the port is known. */
export function listenOn(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/** Closes a server and, for an HTTP server, every connection it holds. */
export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}
