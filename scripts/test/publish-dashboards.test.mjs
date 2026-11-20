import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { baseUrlOf, publishDashboards, readDashboards } from '../obs/publish-dashboards.mjs';

const TOKEN = 'glsa_fake_token_1234567890abcdef';

/** A fake Grafana on loopback: it records every request and answers from a table of handlers. */
async function fakeGrafana(handler = () => undefined) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const recorded = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: text === '' ? undefined : JSON.parse(text),
      };
      requests.push(recorded);
      const answer = handler(recorded) ?? { status: 200, body: {} };
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function dashboardsIn(files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dashboards-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(
      path.join(directory, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return directory;
}

const two = {
  'b.json': { uid: 'b', title: 'B', panels: [] },
  'a.json': { uid: 'a', title: 'A', panels: [] },
  'notes.txt': 'x',
};

test('without the secrets the run succeeds with a notice and calls nothing', async () => {
  const grafana = await fakeGrafana(() => ({ status: 500, body: {} }));
  try {
    for (const env of [
      {},
      { GRAFANA_URL: grafana.url },
      { GRAFANA_SA_TOKEN: TOKEN },
      { GRAFANA_URL: '', GRAFANA_SA_TOKEN: '' },
    ]) {
      const result = await publishDashboards({ env, directory: await dashboardsIn(two) });
      assert.equal(result.exitCode, 0);
      assert.match(result.lines.join('\n'), /^::notice::.*not published/u);
    }
    assert.equal(grafana.requests.length, 0);
  } finally {
    await grafana.close();
  }
});

test('every file is upserted with overwrite into the folder D2RMM, creating the folder first', async () => {
  const grafana = await fakeGrafana(({ method, url }) =>
    method === 'GET' && url === '/api/folders/d2rmm'
      ? { status: 404, body: { message: 'not found' } }
      : undefined,
  );
  try {
    const result = await publishDashboards({
      env: { GRAFANA_URL: `${grafana.url}/`, GRAFANA_SA_TOKEN: TOKEN },
      directory: await dashboardsIn(two),
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      grafana.requests.map((request) => `${request.method} ${request.url}`),
      ['GET /api/folders/d2rmm', 'POST /api/folders', 'POST /api/dashboards/db', 'POST /api/dashboards/db'],
    );
    assert.deepEqual(grafana.requests[1].body, { uid: 'd2rmm', title: 'D2RMM' });
    const posted = grafana.requests.slice(2).map((request) => request.body);
    assert.deepEqual(
      posted.map((body) => body.dashboard.uid),
      ['a', 'b'],
      'one request per json file, in name order, and no other file',
    );
    for (const body of posted) {
      assert.equal(body.overwrite, true);
      assert.equal(body.folderUid, 'd2rmm');
      assert.equal(body.dashboard.id, null, 'the id is the instance own, never the file');
    }
    assert.ok(grafana.requests.every((request) => request.authorization === `Bearer ${TOKEN}`));
    assert.equal(result.lines.join('\n').includes(TOKEN), false, 'the token is never printed');
  } finally {
    await grafana.close();
  }
});

test('an existing folder is not created again', async () => {
  const grafana = await fakeGrafana();
  try {
    const result = await publishDashboards({
      env: { GRAFANA_URL: grafana.url, GRAFANA_SA_TOKEN: TOKEN },
      directory: await dashboardsIn({ 'a.json': two['a.json'] }),
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      grafana.requests.map((request) => `${request.method} ${request.url}`),
      ['GET /api/folders/d2rmm', 'POST /api/dashboards/db'],
    );
  } finally {
    await grafana.close();
  }
});

test('a rejected dashboard fails the run, the others are still tried, and the token never reaches the output', async () => {
  const grafana = await fakeGrafana(({ url, body }) =>
    url === '/api/dashboards/db' && body.dashboard.uid === 'a'
      ? { status: 403, body: { message: `access denied for ${TOKEN}` } }
      : undefined,
  );
  try {
    const result = await publishDashboards({
      env: { GRAFANA_URL: grafana.url, GRAFANA_SA_TOKEN: TOKEN },
      directory: await dashboardsIn(two),
    });
    assert.equal(result.exitCode, 1);
    const output = result.lines.join('\n');
    assert.match(output, /failed a\.json: 403/u);
    assert.match(output, /published b\.json/u);
    assert.equal(output.includes(TOKEN), false);
  } finally {
    await grafana.close();
  }
});

test('a folder that cannot be read stops the run with the status and no token', async () => {
  const grafana = await fakeGrafana(() => ({ status: 401, body: { message: 'invalid token' } }));
  try {
    const result = await publishDashboards({
      env: { GRAFANA_URL: grafana.url, GRAFANA_SA_TOKEN: TOKEN },
      directory: await dashboardsIn(two),
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /401 invalid token/u);
    assert.equal(grafana.requests.length, 1, 'no dashboard is posted after that');
  } finally {
    await grafana.close();
  }
});

test('the URL must be https, or http on loopback, with no credentials', () => {
  assert.equal(baseUrlOf('https://stack.grafana.net/'), 'https://stack.grafana.net');
  assert.equal(baseUrlOf('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.throws(() => baseUrlOf('http://stack.grafana.net'), /https/u);
  assert.throws(
    () => baseUrlOf(['https://', 'name', ':', 'word', '@stack.grafana.net'].join('')),
    /credentials/u,
  );
  assert.throws(() => baseUrlOf('not a url'), /not a URL/u);
});

test('a malformed dashboard file is refused before any call', async () => {
  await assert.rejects(
    readDashboards(await dashboardsIn({ 'bad.json': '{nope' })),
    /bad\.json is not valid JSON/u,
  );
  await assert.rejects(
    readDashboards(await dashboardsIn({ 'bad.json': { title: 'x' } })),
    /needs a uid and a title/u,
  );
  const grafana = await fakeGrafana();
  try {
    const result = await publishDashboards({
      env: { GRAFANA_URL: grafana.url, GRAFANA_SA_TOKEN: TOKEN },
      directory: await dashboardsIn({ 'bad.json': '{nope' }),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(grafana.requests.length, 0);
  } finally {
    await grafana.close();
  }
});

test('the repository dashboards all carry a uid and a title', async () => {
  const dashboards = await readDashboards();
  assert.ok(dashboards.length >= 2);
  assert.equal(
    new Set(dashboards.map(({ dashboard }) => dashboard.uid)).size,
    dashboards.length,
    'uids are unique',
  );
});
