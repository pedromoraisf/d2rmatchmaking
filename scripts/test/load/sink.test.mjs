import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { settingsFromArguments, startSink } from '../../load/containers/sink.mjs';

const TOKEN = 'fake'.repeat(4);
const SLOW_TEST_MS = 20_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTAINERS = path.join(HERE, '..', '..', 'load', 'containers');

/** An OTLP/HTTP request as the API's exporter writes it: request line, headers and a JSON body, byte for byte. */
function wireOf(port, route, body) {
  return Buffer.from(
    `POST ${route} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

/** Writes one request on an open connection and resolves with the answer, once its `{}` body has arrived. */
function exchange(socket, wire) {
  return new Promise((resolve) => {
    let text = '';
    const onData = (chunk) => {
      text += chunk.toString('latin1');
      if (text.endsWith('{}')) {
        socket.off('data', onData);
        resolve(text);
      }
    };
    socket.on('data', onData);
    socket.write(wire);
  });
}

async function openConnection(port) {
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.on('error', () => {});
  return socket;
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

async function sinkFor() {
  return startSink({ listen: '127.0.0.1:0', control: '127.0.0.1:0', token: TOKEN });
}

test('sink counts wire bytes inside the window', { timeout: SLOW_TEST_MS }, async () => {
  const sink = await sinkFor();
  const socket = await openConnection(sink.otlpPort);
  try {
    const before = wireOf(sink.otlpPort, '/v1/traces', '{"resourceSpans":[]}');
    assert.equal(await exchange(socket, before).then((text) => text.startsWith('HTTP/1.1 200')), true);

    assert.equal((await control(sink.controlPort, 'POST', '/window/start')).status, 200);
    const traces = wireOf(sink.otlpPort, '/v1/traces', 'x'.repeat(500));
    const metrics = wireOf(sink.otlpPort, '/v1/metrics', '{"resourceMetrics":[]}');
    await exchange(socket, traces);
    await exchange(socket, metrics);
    const logs = wireOf(sink.otlpPort, '/v1/logs', '{"resourceLogs":[]}');
    await exchange(socket, logs);
    const stopped = await control(sink.controlPort, 'POST', '/window/stop');

    assert.equal(stopped.status, 200);
    assert.equal(
      stopped.body.bytes,
      traces.length + metrics.length + logs.length,
      'the request lines, headers and bodies read inside the window, and nothing outside it',
    );
    assert.ok(stopped.body.seconds >= 0);
    assert.deepEqual(
      stopped.body.byLabel,
      { traces: traces.length, metrics: metrics.length, logs: logs.length },
      'each request is counted under the signal of its path',
    );

    await exchange(socket, wireOf(sink.otlpPort, '/v1/logs', '{}'));
    assert.deepEqual((await control(sink.controlPort, 'POST', '/window/stop')).body, {
      bytes: 0,
      seconds: 0,
    });
  } finally {
    socket.destroy();
    await sink.close();
  }
});

test('sink control endpoints need the bearer and a loopback Host', { timeout: SLOW_TEST_MS }, async () => {
  const sink = await sinkFor();
  const port = sink.controlPort;
  try {
    assert.equal((await control(port, 'POST', '/window/start', { auth: null })).status, 401);
    assert.equal(
      (await control(port, 'POST', '/window/start', { auth: 'Bearer nope-nope-nope-nope' })).status,
      401,
    );
    assert.equal(
      (await control(port, 'POST', '/window/start', { host: `evil.example:${port}` })).status,
      421,
    );
    assert.equal((await control(port, 'GET', '/stats', { host: `localhost:${port}` })).status, 421);

    const stats = await control(port, 'GET', '/stats');
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.openConnections, 'number');
  } finally {
    await sink.close();
  }
});

test('sink answers the OTLP paths with 200 {} and nothing else', { timeout: SLOW_TEST_MS }, async () => {
  const sink = await sinkFor();
  try {
    for (const route of ['/v1/traces', '/v1/metrics', '/v1/logs']) {
      const response = await fetch(`http://127.0.0.1:${sink.otlpPort}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      });
      assert.equal(response.status, 200, `${route} answers 200`);
      assert.equal(await response.text(), '{}', `${route} answers the empty object`);
    }
    const other = await fetch(`http://127.0.0.1:${sink.otlpPort}/v1/unknown`, { method: 'POST', body: '{}' });
    assert.equal(other.status, 404);
  } finally {
    await sink.close();
  }
});

test('the sink takes its token from a file and logs nothing', async () => {
  await assert.rejects(
    settingsFromArguments(['--listen', '127.0.0.1:4318', '--token', TOKEN, '--control', '0.0.0.0:9101']),
    /token-file/,
  );
  await assert.rejects(settingsFromArguments(['--listen', '127.0.0.1:4318']), /--control/);

  for (const file of ['sink.mjs', 'meter.mjs', 'control.mjs']) {
    const source = readFileSync(path.join(CONTAINERS, file), 'utf8');
    assert.equal(/\bconsole\./.test(source), false, `${file} writes no console line`);
    assert.equal(/process\.std(out|err)\./.test(source), false, `${file} writes no stream line`);
  }
});

test(
  'the sink answers a protobuf request with an empty protobuf body',
  { timeout: SLOW_TEST_MS },
  async () => {
    const sink = await sinkFor();
    try {
      for (const route of ['/v1/traces', '/v1/metrics', '/v1/logs']) {
        const response = await fetch(`http://127.0.0.1:${sink.otlpPort}${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
          body: new Uint8Array([0x1f, 0x8b, 8, 0]),
        });
        assert.equal(response.status, 200, `${route} answers 200`);
        assert.equal(response.headers.get('content-type'), 'application/x-protobuf');
        assert.equal((await response.arrayBuffer()).byteLength, 0, `${route} answers an empty message`);
      }
    } finally {
      await sink.close();
    }
  },
);

test('with a capture directory the sink writes each OTLP body to a numbered file by signal, and counts as before', async () => {
  const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(path.join(tmpdir(), 'sink-capture-'));
  const sink = await startSink({
    listen: '127.0.0.1:0',
    control: '127.0.0.1:0',
    token: TOKEN,
    captureDir: directory,
  });
  try {
    const socket = await openConnection(sink.otlpPort);
    await exchange(socket, wireOf(sink.otlpPort, '/v1/traces', '{"a":1}'));
    await exchange(socket, wireOf(sink.otlpPort, '/v1/logs', '{"b":22}'));
    socket.destroy();
    assert.deepEqual(readdirSync(directory).sort(), ['00000001-traces.bin', '00000002-logs.bin']);
    assert.equal(readFileSync(path.join(directory, '00000002-logs.bin'), 'utf8'), '{"b":22}');
  } finally {
    await sink.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the entry reads --capture-dir, and without it the settings carry none', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(path.join(tmpdir(), 'sink-entry-'));
  const tokenFile = path.join(directory, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`);
  try {
    const base = ['--listen', '127.0.0.1:4318', '--control', '0.0.0.0:9101', '--token-file', tokenFile];
    const withFlag = await settingsFromArguments([...base, '--capture-dir', '/capture']);
    assert.equal(withFlag.captureDir, '/capture');
    const without = await settingsFromArguments(base);
    assert.equal('captureDir' in without, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
