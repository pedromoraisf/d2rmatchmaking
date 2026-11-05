// The telemetry sink (design.md § Byte meter and sink; LB-21). The API exports its telemetry to it over loopback
// (`OTEL_EXPORTER_OTLP_ENDPOINT`). The sink answers `200 {}` on the three OTLP/HTTP paths and counts the bytes it reads on
// the wire while the window is open: the request line, the headers and the body. The body is read and dropped, and nothing
// is logged. The control endpoints are the meter's (`control.mjs`): a bearer token and a loopback `Host` are required.
//
// As a container entry: `node sink.mjs --listen <addr> --control <addr> --token-file <path>`.

import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createWindowCounter } from '../lib/window-counter.mjs';
import { closeServer, flagsOf, listenOn, parseAddress, readToken, startControl } from './control.mjs';

const OTLP_PATHS = new Set(['/v1/traces', '/v1/metrics', '/v1/logs']);
const ENTRY_FLAGS = ['--listen', '--control', '--token-file'];

/**
 * Starts the sink. Returns the OTLP and control ports and a `close` that ends every connection.
 * @param {{ listen: string, control: string, token: string, now?: () => number }} settings
 * @returns {Promise<{ otlpPort: number, controlPort: number, close: () => Promise<void> }>}
 */
export async function startSink({ listen, control, token, now = () => performance.now() }) {
  const counter = createWindowCounter(now);
  const sockets = new Set();
  let open = 0;
  let peak = 0;

  const otlp = createServer((request, response) => {
    request.resume();
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'POST' || !OTLP_PATHS.has(path)) {
      response.writeHead(404, { 'content-length': 0 });
      response.end();
      return;
    }
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': 2 });
      response.end('{}');
    });
  });

  otlp.on('connection', (socket) => {
    sockets.add(socket);
    open += 1;
    peak = Math.max(peak, open);
    socket.on('data', (chunk) => counter.add(chunk.length));
    socket.on('close', () => {
      sockets.delete(socket);
      open -= 1;
    });
  });

  const listenAt = parseAddress(listen);
  await listenOn(otlp, listenAt.host, listenAt.port);
  const controlHandle = await startControl({
    address: control,
    token,
    counter,
    stats: () => ({ openConnections: open, peakConnections: peak }),
  });

  return {
    otlpPort: otlp.address().port,
    controlPort: controlHandle.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(otlp);
      await controlHandle.close();
    },
  };
}

/**
 * The settings of a container entry from its arguments and its token file (never a token flag).
 * @param {string[]} argv the arguments after the script name
 * @returns {Promise<{ listen: string, control: string, token: string }>}
 */
export async function settingsFromArguments(argv) {
  const flags = flagsOf(argv, ENTRY_FLAGS);
  for (const key of ['listen', 'control', 'tokenFile']) {
    if (flags[key] === undefined) {
      throw new TypeError(`the sink needs --${key === 'tokenFile' ? 'token-file' : key}`);
    }
  }
  return {
    listen: flags.listen,
    control: flags.control,
    token: await readToken(flags.tokenFile),
  };
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  await startSink(await settingsFromArguments(process.argv.slice(2)));
}
