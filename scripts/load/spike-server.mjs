// Fixture server of the k6 spike (T1). It runs inside a node container with scripts/load mounted read-only, on a
// throwaway network, and publishes no port. It serves what the journey of design.md § k6 journey needs:
//   POST /api/auth/test-login   Set-Cookie with a Secure __Host- cookie (same origin)
//   GET  /api/whoami            200 only with the explicit Cookie header
//   GET  /api/stream/site       SSE, cookie required; frames id/event/data and ': ka' comments
//   GET  /api/stream/agent      SSE, agent token and X-Agent-Version required
//   POST /api/match             same origin + cookie; queues room.assigned for both streams
//   POST /api/observations      same origin + agent token; answers 202, then room.stage_changed (created) on site
//   POST /api/heartbeat         agent token; counts heartbeats that arrive while both streams are open
//   GET  /stats                 counters, read by the spike runner through docker exec
import { createServer } from 'node:http';

const PORT = 8080;
const HOLD_MS = 20_000;
const KEEPALIVE_MS = 1_000;
const ORIGIN = 'http://spike.test';
const AGENT_TOKEN = 'd2rmm_a_spike';
const COOKIE_NAME = '__Host-d2rmm_session';
const COOKIE_VALUE = 'spike-session-value';

const stats = {
  siteConnected: 0,
  agentConnected: 0,
  siteRejected: 0,
  agentRejected: 0,
  sseBytes: 0,
  sseFrames: 0,
  siteSpanMs: null,
  agentSpanMs: null,
  matches: 0,
  observations: 0,
  observationsRejected: 0,
  createdSent: 0,
  heartbeats: 0,
  heartbeatsWhileBothOpen: 0,
  heartbeatsRejected: 0,
  whoamiOk: 0,
  whoamiRejected: 0,
  loginSetsSecureCookie: 0,
};

const streams = { site: null, agent: null };
const pending = { site: [], agent: [] };
let nextEventId = 1;

function sseWrite(name, text) {
  const res = streams[name];
  if (!res) return false;
  res.write(text);
  stats.sseBytes += Buffer.byteLength(text);
  return true;
}

function sendEvent(name, eventName, data) {
  const frame = `id: ${nextEventId}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  nextEventId += 1;
  stats.sseFrames += 1;
  if (!sseWrite(name, frame)) pending[name].push(frame);
}

function flushPending(name) {
  while (pending[name].length > 0 && streams[name]) {
    sseWrite(name, pending[name].shift());
  }
}

function openStream(name, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  streams[name] = res;
  stats[`${name}Connected`] += 1;
  const startedAt = Date.now();
  flushPending(name);
  const keepalive = setInterval(() => sseWrite(name, ': ka\n\n'), KEEPALIVE_MS);
  const finish = () => {
    clearInterval(keepalive);
    clearTimeout(hold);
    if (streams[name] === res) streams[name] = null;
    stats[`${name}SpanMs`] = Date.now() - startedAt;
  };
  const hold = setTimeout(() => {
    finish();
    res.end();
  }, HOLD_MS);
  res.on('close', finish);
  res.on('error', finish);
}

function hasSessionCookie(req) {
  return (req.headers.cookie ?? '')
    .split(';')
    .some((pair) => pair.trim() === `${COOKIE_NAME}=${COOKIE_VALUE}`);
}

function hasAgentToken(req) {
  return req.headers.authorization === `Bearer ${AGENT_TOKEN}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /health') return json(res, 200, { ok: true });
  if (route === 'GET /stats') return json(res, 200, stats);

  if (route === 'POST /api/auth/test-login') {
    if (req.headers.origin !== ORIGIN) return json(res, 403, { error: 'origin' });
    stats.loginSetsSecureCookie += 1;
    res.setHeader('set-cookie', `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; Secure; HttpOnly; SameSite=Lax`);
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/whoami') {
    if (!hasSessionCookie(req)) {
      stats.whoamiRejected += 1;
      return json(res, 401, { error: 'session' });
    }
    stats.whoamiOk += 1;
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/stream/site') {
    if (!hasSessionCookie(req)) {
      stats.siteRejected += 1;
      return json(res, 401, { error: 'session' });
    }
    return openStream('site', res);
  }

  if (route === 'GET /api/stream/agent') {
    if (!hasAgentToken(req) || !req.headers['x-agent-version']) {
      stats.agentRejected += 1;
      return json(res, 401, { error: 'agent' });
    }
    return openStream('agent', res);
  }

  if (route === 'POST /api/match') {
    await readBody(req);
    if (req.headers.origin !== ORIGIN || !hasSessionCookie(req)) return json(res, 403, { error: 'match' });
    stats.matches += 1;
    sendEvent('agent', 'room.assigned', { roomId: 'spike-room-1' });
    sendEvent('site', 'room.assigned', { roomId: 'spike-room-1' });
    return json(res, 202, { roomId: 'spike-room-1' });
  }

  if (route === 'POST /api/observations') {
    await readBody(req);
    if (req.headers.origin !== ORIGIN || !hasAgentToken(req)) {
      stats.observationsRejected += 1;
      return json(res, 403, { error: 'observation' });
    }
    stats.observations += 1;
    json(res, 202, { ok: true });
    setTimeout(() => {
      stats.createdSent += 1;
      sendEvent('site', 'room.stage_changed', { roomId: 'spike-room-1', stage: 'created' });
    }, 50);
    return undefined;
  }

  if (route === 'POST /api/heartbeat') {
    await readBody(req);
    if (!hasAgentToken(req)) {
      stats.heartbeatsRejected += 1;
      return json(res, 401, { error: 'agent' });
    }
    stats.heartbeats += 1;
    if (streams.site && streams.agent) stats.heartbeatsWhileBothOpen += 1;
    return json(res, 202, { ok: true });
  }

  return json(res, 404, { error: 'not-found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`spike-server listening on ${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
