// The byte meter in front of the API (design.md § Byte meter and sink; LB-14). A TCP pipe: the players connect to `listen`,
// the meter connects to `upstream` (the API, reached through the sink's network namespace) and copies both ways. The bytes
// that travel from the upstream to a player are counted while the window is open, then passed on unchanged; nothing is
// kept, nothing is logged and nothing is written to disk. The bytes a player sends are not counted (they are not the
// API's bytes).
//
// As a container entry: `node meter.mjs --listen <addr> --upstream <host:port> --control <addr> --token-file <path>`.

import { connect, createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createWindowCounter } from '../lib/window-counter.mjs';
import { closeServer, flagsOf, listenOn, parseAddress, readToken, startControl } from './control.mjs';

const ENTRY_FLAGS = ['--listen', '--upstream', '--control', '--token-file'];

/**
 * Starts the meter. Returns the ports it listens on and a `close` that ends every connection.
 * @param {{ listen: string, upstream: string, control: string, token: string, now?: () => number }} settings
 *   `listen` and `control` are `host:port` (port 0 for a free port); `now` is a clock in milliseconds.
 * @returns {Promise<{ proxyPort: number, controlPort: number, close: () => Promise<void> }>}
 */
export async function startMeter({ listen, upstream, control, token, now = () => performance.now() }) {
  const upstreamAt = parseAddress(upstream);
  const counter = createWindowCounter(now);
  const sockets = new Set();
  let open = 0;
  let peak = 0;

  const proxy = createServer((client) => {
    const backend = connect(upstreamAt.port, upstreamAt.host);
    const counting = new Transform({
      transform(chunk, _encoding, done) {
        counter.add(chunk.length);
        done(null, chunk);
      },
    });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      open -= 1;
    };
    const drop = () => {
      release();
      sockets.delete(client);
      sockets.delete(backend);
      client.destroy();
      backend.destroy();
      counting.destroy();
    };
    for (const socket of [client, backend]) {
      sockets.add(socket);
      socket.on('error', drop);
      socket.on('close', drop);
    }
    counting.on('error', drop);

    open += 1;
    peak = Math.max(peak, open);
    client.pipe(backend);
    backend.pipe(counting).pipe(client);
  });

  const proxyAt = parseAddress(listen);
  await listenOn(proxy, proxyAt.host, proxyAt.port);
  const controlHandle = await startControl({
    address: control,
    token,
    counter,
    stats: () => ({ openConnections: open, peakConnections: peak }),
  });

  return {
    proxyPort: proxy.address().port,
    controlPort: controlHandle.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(proxy);
      await controlHandle.close();
    },
  };
}

/**
 * The settings of a container entry from its arguments and its token file (never a token flag).
 * @param {string[]} argv the arguments after the script name
 * @returns {Promise<{ listen: string, upstream: string, control: string, token: string }>}
 */
export async function settingsFromArguments(argv) {
  const flags = flagsOf(argv, ENTRY_FLAGS);
  for (const key of ['listen', 'upstream', 'control', 'tokenFile']) {
    if (flags[key] === undefined)
      throw new TypeError(`the meter needs --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  return {
    listen: flags.listen,
    upstream: flags.upstream,
    control: flags.control,
    token: await readToken(flags.tokenFile),
  };
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  await startMeter(await settingsFromArguments(process.argv.slice(2)));
}
