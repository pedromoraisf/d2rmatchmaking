import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer, connect } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { flagsOf, readToken } from '../../load/containers/control.mjs';
import { settingsFromArguments, startMeter } from '../../load/containers/meter.mjs';

const TOKEN = 'k3m9q2w7e5r8t1y6';
const REPLY_BYTES = 1000;
const PING = Buffer.from('ping');

/** A fake API on loopback: every chunk it reads gets one reply of REPLY_BYTES. */
async function startApi() {
  const sockets = new Set();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on('data', () => socket.write(Buffer.alloc(REPLY_BYTES, 0x61)));
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A player on the meter's port: each exchange sends one ping and waits for one whole reply. */
async function playerOf(port) {
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  let buffered = 0;
  let waiting = null;
  socket.on('data', (chunk) => {
    buffered += chunk.length;
    if (waiting && buffered >= REPLY_BYTES) {
      buffered -= REPLY_BYTES;
      const resolve = waiting;
      waiting = null;
      resolve();
    }
  });
  socket.on('error', () => {});
  return {
    exchange: () =>
      new Promise((resolve) => {
        waiting = resolve;
        socket.write(PING);
      }),
    close: () => socket.destroy(),
  };
}

/** One request to a control endpoint; `auth: null` sends no Authorization header. */
function control(port, method, route, { auth = `Bearer ${TOKEN}`, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (auth !== null) headers.authorization = auth;
    const request = httpRequest({ host: '127.0.0.1', port, method, path: route, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, body: text === '' ? null : JSON.parse(text) });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function meterFor(apiPort) {
  return startMeter({
    listen: '127.0.0.1:0',
    upstream: `127.0.0.1:${apiPort}`,
    control: '127.0.0.1:0',
    token: TOKEN,
  });
}

const SLOW_TEST_MS = 20_000;

test('meter counts API bytes inside the window', { timeout: SLOW_TEST_MS }, async () => {
  const api = await startApi();
  const meter = await meterFor(api.port);
  const player = await playerOf(meter.proxyPort);
  try {
    await player.exchange();
    const started = await control(meter.controlPort, 'POST', '/window/start');
    assert.equal(started.status, 200);

    await player.exchange();
    await player.exchange();
    const stopped = await control(meter.controlPort, 'POST', '/window/stop');
    assert.equal(stopped.status, 200);
    assert.equal(
      stopped.body.bytes,
      2 * REPLY_BYTES,
      'two replies inside the window; the player pings are not the API',
    );
    assert.ok(stopped.body.seconds >= 0, 'the window has a length in seconds');

    await player.exchange();
    const after = await control(meter.controlPort, 'POST', '/window/stop');
    assert.deepEqual(after.body, { bytes: 0, seconds: 0 }, 'bytes after the window are not counted');
  } finally {
    player.close();
    await meter.close();
    await api.close();
  }
});

test('meter control endpoints need the bearer and a loopback Host', { timeout: SLOW_TEST_MS }, async () => {
  const api = await startApi();
  const meter = await meterFor(api.port);
  const player = await playerOf(meter.proxyPort);
  const port = meter.controlPort;
  try {
    assert.equal((await control(port, 'POST', '/window/start', { auth: null })).status, 401);
    assert.equal(
      (await control(port, 'POST', '/window/start', { auth: 'Bearer wrong-token-value' })).status,
      401,
    );
    assert.equal(
      (await control(port, 'POST', '/window/start', { host: `evil.example:${port}` })).status,
      421,
    );
    assert.equal(
      (await control(port, 'POST', '/window/start', { host: `127.0.0.1:${port + 1}` })).status,
      421,
    );

    await player.exchange();
    assert.deepEqual(
      (await control(port, 'POST', '/window/stop')).body,
      { bytes: 0, seconds: 0 },
      'refused starts open no window',
    );

    const stats = await control(port, 'GET', '/stats');
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.openConnections, 'number');
    assert.equal(typeof stats.body.peakConnections, 'number');
  } finally {
    player.close();
    await meter.close();
    await api.close();
  }
});

test(
  'the meter takes its token from a file, never from a command-line value',
  { timeout: SLOW_TEST_MS },
  async () => {
    assert.throws(() => flagsOf(['--token', TOKEN], ['--listen', '--token-file']), /--token-file/);
    assert.throws(
      () => flagsOf(['--listen', '127.0.0.1:0', '--listen', '127.0.0.1:1'], ['--listen']),
      /given once/,
    );
    assert.deepEqual(flagsOf(['--token-file', '/run/d2rmm/token'], ['--token-file']), {
      tokenFile: '/run/d2rmm/token',
    });

    const dir = await mkdtemp(path.join(tmpdir(), 'd2rmm-load-meter-'));
    try {
      const file = path.join(dir, 'token');
      await writeFile(file, `${TOKEN}\n`, { mode: 0o600 });
      assert.equal(await readToken(file), TOKEN);

      const settings = await settingsFromArguments([
        '--listen',
        '0.0.0.0:8080',
        '--upstream',
        'sink:8080',
        '--control',
        '0.0.0.0:9100',
        '--token-file',
        file,
      ]);
      assert.deepEqual(settings, {
        listen: '0.0.0.0:8080',
        upstream: 'sink:8080',
        control: '0.0.0.0:9100',
        token: TOKEN,
      });
      await assert.rejects(settingsFromArguments(['--listen', '0.0.0.0:8080']), /--upstream/);

      await writeFile(file, 'short\n');
      await assert.rejects(
        readToken(file),
        (error) => error instanceof TypeError && !error.message.includes('short'),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
