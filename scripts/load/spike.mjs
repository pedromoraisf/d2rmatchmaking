// T1 spike of load-baseline (design.md § k6 journey and § Risks). It builds the pinned k6 image, starts the fixture
// server (spike-server.mjs) on a throwaway network and runs one k6 script against it. The script holds a site and an
// agent stream in two scenarios, posts inside an event handler, sends heartbeats from a third constant-arrival-rate
// scenario, sends an explicit Cookie header, imports a .mjs helper and tags metrics by its own elapsed time.
// It prints one JSON line per finding and exits 0 only when every role holds. Its containers, its network and its
// work directory are removed on every exit path. Nothing is published to the host and no secret is used.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCKER_DIR = join(HERE, 'docker');
const K6_IMAGE = 'd2rmm-load-k6:spike';
const NODE_IMAGE =
  'node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9';
const K6_MEMORY = '1500m';
const RUN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUMMARY_PREFIX = 'SPIKE_RESULT ';

// The k6 script of the spike. It is written into the work directory as spike-journey.mjs. Plain strings only, so the
// file contains no template literals.
const K6_JOURNEY = `/* global __ENV */
import sse from 'k6/x/sse';
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { windowOf } from './spike-state.mjs';

const BASE = __ENV.BASE;
const ORIGIN = 'http://spike.test';
const AGENT_TOKEN = 'd2rmm_a_spike';
const AGENT_VERSION = '0.0.0-spike';
const SESSION = '__Host-d2rmm_session';

const siteAssigned = new Counter('spike_site_assigned');
const agentAssigned = new Counter('spike_agent_assigned');
const matchOk = new Counter('spike_match_ok');
const matchFailed = new Counter('spike_match_failed');
const postInHandlerOk = new Counter('spike_post_in_handler_ok');
const postInHandlerFailed = new Counter('spike_post_in_handler_failed');
const createdFrames = new Counter('spike_created_frames');
const heartbeatOk = new Counter('spike_heartbeat_ok');
const heartbeatFailed = new Counter('spike_heartbeat_failed');
const bareWhoami401 = new Counter('spike_bare_whoami_401');
const bareWhoamiOther = new Counter('spike_bare_whoami_other');
const siteStream200 = new Counter('spike_site_stream_200');
const agentStream200 = new Counter('spike_agent_stream_200');
const createdLatency = new Trend('spike_created_latency_ms');
const siteSpan = new Trend('spike_site_span_ms');
const agentSpan = new Trend('spike_agent_span_ms');

export const options = {
  scenarios: {
    site: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '45s', exec: 'site' },
    agent: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '45s', exec: 'agent' },
    heartbeat: {
      executor: 'constant-arrival-rate',
      rate: 4,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 2,
      maxVUs: 4,
      startTime: '4s',
      exec: 'heartbeat',
    },
  },
  thresholds: {
    'http_reqs{window:ramp}': ['count>=0'],
    'http_reqs{window:hold}': ['count>=0'],
    'http_reqs{window:late}': ['count>=0'],
    'spike_created_latency_ms{window:hold}': ['avg>=0'],
  },
};

export function site() {
  const login = http.post(BASE + '/api/auth/test-login', null, { headers: { Origin: ORIGIN } });
  const setCookie = login.headers['Set-Cookie'] || login.headers['set-cookie'] || '';
  const match = setCookie.match(/__Host-d2rmm_session=([^;]+)/);
  const cookie = SESSION + '=' + (match ? match[1] : '');

  const bare = http.get(BASE + '/api/whoami');
  if (bare.status === 401) bareWhoami401.add(1);
  else bareWhoamiOther.add(1);

  const started = exec.instance.currentTestRunDuration;
  const res = sse.open(BASE + '/api/stream/site', { headers: { Cookie: cookie, Origin: ORIGIN } }, function (client) {
    client.on('open', function () {
      const m = http.post(BASE + '/api/match', '{}', {
        headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
        tags: { window: windowOf(exec.instance.currentTestRunDuration) },
      });
      if (m.status === 202) matchOk.add(1);
      else matchFailed.add(1);
    });

    let observedAt = 0;
    client.on('event', function (event) {
      if (event.name === 'room.assigned') {
        siteAssigned.add(1);
        observedAt = exec.instance.currentTestRunDuration;
        const obs = http.post(BASE + '/api/observations', JSON.stringify({ roomId: 'spike-room-1' }), {
          headers: { Authorization: 'Bearer ' + AGENT_TOKEN, Origin: ORIGIN, 'Content-Type': 'application/json' },
          tags: { window: windowOf(observedAt) },
        });
        if (obs.status === 202) postInHandlerOk.add(1);
        else postInHandlerFailed.add(1);
      } else if (event.name === 'room.stage_changed') {
        const data = JSON.parse(event.data);
        if (data.stage === 'created') {
          createdFrames.add(1);
          const now = exec.instance.currentTestRunDuration;
          createdLatency.add(now - observedAt, { window: windowOf(now) });
        }
      }
    });
  });
  if (res.status === 200) siteStream200.add(1);
  siteSpan.add(exec.instance.currentTestRunDuration - started);
}

export function agent() {
  const started = exec.instance.currentTestRunDuration;
  const res = sse.open(BASE + '/api/stream/agent', {
    headers: { Authorization: 'Bearer ' + AGENT_TOKEN, 'X-Agent-Version': AGENT_VERSION },
  }, function (client) {
    client.on('event', function (event) {
      if (event.name === 'room.assigned') agentAssigned.add(1);
    });
  });
  if (res.status === 200) agentStream200.add(1);
  agentSpan.add(exec.instance.currentTestRunDuration - started);
}

export function heartbeat() {
  const res = http.post(BASE + '/api/heartbeat', '{}', {
    headers: {
      Authorization: 'Bearer ' + AGENT_TOKEN,
      'X-Agent-Version': AGENT_VERSION,
      'X-Forwarded-For': '10.0.0.7',
      'Content-Type': 'application/json',
    },
    tags: { window: windowOf(exec.instance.currentTestRunDuration) },
  });
  if (res.status === 202) heartbeatOk.add(1);
  else heartbeatFailed.add(1);
}

export function handleSummary(data) {
  const values = {};
  for (const name of Object.keys(data.metrics)) {
    if (name.indexOf('spike_') === 0 || name.indexOf('http_reqs') === 0 || name === 'data_received') {
      values[name] = data.metrics[name].values;
    }
  }
  return { stdout: '${SUMMARY_PREFIX}' + JSON.stringify(values) + '\\n' };
}
`;

// The stream-only k6 script: one agent stream and nothing else, so the k6 data_received total can be compared with the
// server's SSE bytes of that stream alone (no POST reply is in the total).
const K6_STREAM_ONLY = `import sse from 'k6/x/sse';

export const options = {
  scenarios: {
    agent: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30s' },
  },
};

export default function () {
  sse.open(__ENV.BASE + '/api/stream/agent', {
    headers: { Authorization: 'Bearer d2rmm_a_spike', 'X-Agent-Version': '0.0.0-spike' },
  }, function () {});
}

export function handleSummary(data) {
  return { stdout: '${SUMMARY_PREFIX}' + JSON.stringify({ data_received: data.metrics.data_received.values }) + '\\n' };
}
`;

// The helper module imported by the k6 script. It is a plain ES module with no Node import.
const K6_HELPER = `// Helper of the k6 spike: a plain ES module with no Node import.
export function windowOf(elapsedMs) {
  if (elapsedMs < 5000) return 'ramp';
  if (elapsedMs < 15000) return 'hold';
  return 'late';
}
`;

function runIdFrom(bytes) {
  return [...bytes].map((byte) => RUN_ALPHABET[byte % RUN_ALPHABET.length]).join('');
}

function docker(args) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function finding(name, ok, detail) {
  console.log(JSON.stringify({ finding: name, ok, ...detail }));
  return ok;
}

async function waitForServer(name) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = await docker([
      'exec',
      name,
      'node',
      '-e',
      "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
    ]);
    if (probe.code === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function parseSummary(stdout) {
  const line = stdout.split('\n').find((text) => text.startsWith(SUMMARY_PREFIX));
  if (!line) return null;
  return JSON.parse(line.slice(SUMMARY_PREFIX.length));
}

async function readStats(serverName) {
  const read = await docker([
    'exec',
    serverName,
    'node',
    '-e',
    "fetch('http://127.0.0.1:8080/stats').then((r) => r.text()).then((t) => process.stdout.write(t))",
  ]);
  return read.code === 0 ? JSON.parse(read.stdout) : null;
}

function countOf(values, name) {
  return values && values[name] && typeof values[name].count === 'number' ? values[name].count : 0;
}

async function main() {
  const runId = runIdFrom(randomBytes(8));
  const label = `d2rmm-load=${runId}`;
  const network = `d2rmm-load-${runId}-net`;
  const serverName = `d2rmm-load-${runId}-spike-server`;
  const k6Name = `d2rmm-load-${runId}-spike-k6`;
  const created = { containers: [], network: false, workDir: null };
  let cleanedUp = false;
  let leftBehind = [];

  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const name of created.containers.reverse()) {
      const removed = await docker(['rm', '-f', name]);
      if (removed.code !== 0) leftBehind.push(name);
    }
    if (created.network) {
      const removed = await docker(['network', 'rm', network]);
      if (removed.code !== 0) leftBehind.push(network);
    }
    if (created.workDir) await rm(created.workDir, { recursive: true, force: true });
  }

  const onSignal = (signal) => {
    cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);

  let ok = false;
  try {
    const build = await docker([
      'build',
      '-f',
      join(DOCKER_DIR, 'k6.Dockerfile'),
      '-t',
      K6_IMAGE,
      DOCKER_DIR,
    ]);
    if (build.code !== 0) {
      console.error(`docker build of the k6 image failed (exit ${build.code}): ${build.stderr.slice(-800)}`);
      return false;
    }
    const version = await docker(['run', '--rm', K6_IMAGE, 'version']);
    finding('k6-version', version.code === 0, { output: version.stdout.trim() });

    created.workDir = await mkdtemp(join(tmpdir(), 'd2rmm-load-spike-'));
    await chmod(created.workDir, 0o700);
    const inDir = join(created.workDir, 'in');
    await mkdir(inDir, { mode: 0o700 });
    await writeFile(join(inDir, 'spike-journey.mjs'), K6_JOURNEY, { mode: 0o600 });
    await writeFile(join(inDir, 'spike-state.mjs'), K6_HELPER, { mode: 0o600 });
    // The k6 container runs as uid 12345, not as the host user. The files are 0600 as design.md requires; if the
    // container cannot read them over the bind mount, the spike falls back to 0644 and records it.
    const readable600 =
      (
        await docker([
          'run',
          '--rm',
          '--entrypoint',
          'cat',
          '-v',
          `${inDir}:/work/in:ro`,
          K6_IMAGE,
          '/work/in/spike-state.mjs',
        ])
      ).code === 0;
    if (!readable600) {
      await chmod(join(inDir, 'spike-journey.mjs'), 0o644);
      await chmod(join(inDir, 'spike-state.mjs'), 0o644);
    }
    finding('in-files-readable-by-k6-at-0600', readable600, {
      fallback: readable600 ? null : 'mode 0644 for the spike files',
    });

    const net = await docker(['network', 'create', '--label', label, network]);
    if (net.code !== 0) {
      console.error(`docker network create failed: ${net.stderr.trim()}`);
      return false;
    }
    created.network = true;

    const server = await docker([
      'run',
      '-d',
      '--name',
      serverName,
      '--network',
      network,
      '--label',
      label,
      '--memory',
      '256m',
      '-v',
      `${HERE}:/app:ro`,
      NODE_IMAGE,
      'node',
      '/app/spike-server.mjs',
    ]);
    if (server.code !== 0) {
      console.error(`starting the fixture server failed: ${server.stderr.trim()}`);
      return false;
    }
    created.containers.push(serverName);
    if (!(await waitForServer(serverName))) {
      console.error('the fixture server did not answer /health');
      return false;
    }

    const k6 = await docker([
      'run',
      '--name',
      k6Name,
      '--network',
      network,
      '--label',
      label,
      '--memory',
      K6_MEMORY,
      '-e',
      `BASE=http://${serverName}:8080`,
      '-v',
      `${inDir}:/work/in:ro`,
      K6_IMAGE,
      'run',
      '--no-color',
      '/work/in/spike-journey.mjs',
    ]);
    created.containers.push(k6Name);
    finding('k6-exit', k6.code === 0, {
      code: k6.code,
      stderrTail: k6.code === 0 ? '' : k6.stderr.slice(-600),
    });

    const values = parseSummary(k6.stdout);
    const stats = await readStats(serverName);
    if (!values || !stats) {
      console.error('no summary or no server stats; the server logs follow');
      const logs = await docker(['logs', '--tail', '40', serverName]);
      console.error(logs.stdout + logs.stderr);
      return false;
    }

    const dataReceived = countOf(values, 'data_received');
    const results = [
      finding('two-streams-held', stats.siteSpanMs >= 15000 && stats.agentSpanMs >= 15000, {
        siteSpanMs: stats.siteSpanMs,
        agentSpanMs: stats.agentSpanMs,
        k6SiteSpanAvgMs: values.spike_site_span_ms ? values.spike_site_span_ms.avg : null,
        k6AgentSpanAvgMs: values.spike_agent_span_ms ? values.spike_agent_span_ms.avg : null,
      }),
      finding(
        'agent-stream-frames',
        countOf(values, 'spike_agent_assigned') >= 1 && stats.agentConnected === 1,
        {
          agentAssignedFrames: countOf(values, 'spike_agent_assigned'),
        },
      ),
      finding('explicit-cookie', countOf(values, 'spike_match_ok') >= 1 && stats.siteRejected === 0, {
        matchOk: countOf(values, 'spike_match_ok'),
        siteRejected: stats.siteRejected,
        bareWhoami401: countOf(values, 'spike_bare_whoami_401'),
        bareWhoamiOther: countOf(values, 'spike_bare_whoami_other'),
      }),
      finding(
        'post-inside-event-handler',
        countOf(values, 'spike_post_in_handler_ok') >= 1 &&
          stats.observations >= 1 &&
          countOf(values, 'spike_created_frames') >= 1,
        {
          postInHandlerOk: countOf(values, 'spike_post_in_handler_ok'),
          postInHandlerFailed: countOf(values, 'spike_post_in_handler_failed'),
          serverObservations: stats.observations,
          createdFramesAtK6: countOf(values, 'spike_created_frames'),
          serverCreatedSent: stats.createdSent,
          createdLatencyCount: values.spike_created_latency_ms ? values.spike_created_latency_ms.count : 0,
        },
      ),
      finding(
        'heartbeats-while-both-streams-open',
        stats.heartbeatsWhileBothOpen >= 1 &&
          countOf(values, 'spike_heartbeat_ok') >= 1 &&
          countOf(values, 'spike_heartbeat_failed') === 0,
        {
          heartbeatOk: countOf(values, 'spike_heartbeat_ok'),
          heartbeatFailed: countOf(values, 'spike_heartbeat_failed'),
          serverHeartbeats: stats.heartbeats,
          serverHeartbeatsWhileBothOpen: stats.heartbeatsWhileBothOpen,
        },
      ),
      finding('mjs-import-and-window-tags', countOf(values, 'http_reqs{window:hold}') >= 1 && k6.code === 0, {
        httpReqsHold: countOf(values, 'http_reqs{window:hold}'),
        httpReqsRamp: countOf(values, 'http_reqs{window:ramp}'),
        httpReqsLate: countOf(values, 'http_reqs{window:late}'),
      }),
      finding('data-received-primary-run', true, {
        informational: true,
        k6DataReceivedBytes: dataReceived,
        serverSseBytes: stats.sseBytes,
        note: 'the total includes the POST replies, so it does not answer the question alone; see the stream-only run',
      }),
    ];

    // Stream-only run: one agent stream, no POST. Its k6 data_received total is compared with the server's SSE bytes
    // of that stream, counted between two stats reads.
    const streamOnlyName = `${k6Name}-stream-only`;
    const streamOnlyFile = join(inDir, 'spike-stream-only.mjs');
    await writeFile(streamOnlyFile, K6_STREAM_ONLY, { mode: 0o600 });
    if (!readable600) await chmod(streamOnlyFile, 0o644);
    const sseBefore = (await readStats(serverName))?.sseBytes ?? 0;
    const only = await docker([
      'run',
      '--name',
      streamOnlyName,
      '--network',
      network,
      '--label',
      label,
      '--memory',
      K6_MEMORY,
      '-e',
      `BASE=http://${serverName}:8080`,
      '-v',
      `${inDir}:/work/in:ro`,
      K6_IMAGE,
      'run',
      '--no-color',
      '/work/in/spike-stream-only.mjs',
    ]);
    created.containers.push(streamOnlyName);
    const onlySummary = parseSummary(only.stdout);
    const sseAfter = (await readStats(serverName))?.sseBytes ?? 0;
    const sseOnly = sseAfter - sseBefore;
    const dataOnly = countOf(onlySummary, 'data_received');
    results.push(
      finding('stream-only-run-exit', only.code === 0 && onlySummary !== null, { code: only.code }),
    );
    finding('data-received-counts-sse', dataOnly > 0 && dataOnly >= sseOnly, {
      k6DataReceivedBytes: dataOnly,
      serverAgentSseBytes: sseOnly,
      note: 'counts when k6 reports at least the stream bytes the server wrote, and more than zero',
    });
    ok = results.every(Boolean);
    finding('primary-roles', ok, { fallbackNeeded: !ok });
  } finally {
    await cleanup();
  }
  if (leftBehind.length > 0) {
    console.error(`left behind, remove by name: ${leftBehind.join(', ')}`);
    return false;
  }
  return ok;
}

main().then(
  (ok) => {
    process.exitCode = ok ? 0 : 1;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
