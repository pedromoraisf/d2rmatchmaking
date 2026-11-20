// Publishes the dashboards of `infra/observability/dashboards/` to Grafana (Grafana Cloud in production) through the HTTP
// API, as code. Each file is upserted with `POST /api/dashboards/db` and `overwrite: true` into the folder "D2RMM", which
// is created first when it is missing. `GRAFANA_URL` and `GRAFANA_SA_TOKEN` (a service account token with dashboard write)
// are read only from the environment, never from an argument, and the token is never printed. Without both variables the
// run prints a notice and succeeds, so a repository without the secrets does not turn red. Zero dependencies.
//
// Usage: `node scripts/obs/publish-dashboards.mjs`

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARDS_DIR = join(HERE, '..', '..', 'infra', 'observability', 'dashboards');
export const FOLDER = { uid: 'd2rmm', title: 'D2RMM' };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REASON_LENGTH = 200;

/** The base URL of the Grafana instance: https, or http on loopback (the tests), with no path, query or credentials. */
export function baseUrlOf(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError('GRAFANA_URL is not a URL');
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) throw new TypeError('GRAFANA_URL must be https (http only on loopback)');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError('GRAFANA_URL carries no credentials, query or fragment');
  }
  return url.origin + url.pathname.replace(/\/+$/u, '');
}

/** The error text of an answer: its status and a short `message`, with the token removed if it came back. */
function reasonOf(status, body, token) {
  let message = '';
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string') message = parsed.message;
  } catch {
    // An answer that is not JSON has no message to show.
  }
  const text = `${status}${message === '' ? '' : ` ${message}`}`.split(token).join('[redacted]');
  return text.slice(0, MAX_REASON_LENGTH);
}

/**
 * Reads the dashboard files: every `*.json` of the directory, sorted, each with a `uid` and a `title`.
 * @param {string} directory
 */
export async function readDashboards(directory = DASHBOARDS_DIR) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const dashboards = [];
  for (const name of names) {
    let dashboard;
    try {
      dashboard = JSON.parse(await readFile(join(directory, name), 'utf8'));
    } catch {
      throw new TypeError(`${name} is not valid JSON`);
    }
    if (typeof dashboard?.uid !== 'string' || typeof dashboard?.title !== 'string') {
      throw new TypeError(`${name} needs a uid and a title`);
    }
    dashboards.push({ name, dashboard });
  }
  return dashboards;
}

/**
 * Upserts every dashboard. Returns the exit code and the lines to print (never the token).
 * @param {{
 *   env: Record<string, string | undefined>,
 *   directory?: string,
 *   fetchFn?: typeof fetch,
 * }} input
 * @returns {Promise<{ exitCode: 0 | 1, lines: string[] }>}
 */
export async function publishDashboards({ env, directory = DASHBOARDS_DIR, fetchFn = fetch }) {
  const url = env.GRAFANA_URL ?? '';
  const token = env.GRAFANA_SA_TOKEN ?? '';
  if (url === '' || token === '') {
    return {
      exitCode: 0,
      lines: ['::notice::GRAFANA_URL and GRAFANA_SA_TOKEN are not set; the dashboards were not published.'],
    };
  }

  const lines = [];
  let base;
  let files;
  try {
    base = baseUrlOf(url);
    files = await readDashboards(directory);
  } catch (error) {
    return { exitCode: 1, lines: [`publish failed: ${error.message}`] };
  }

  const call = async (method, path, payload) => {
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: response.status, ok: response.ok, body: await response.text() };
  };

  try {
    const found = await call('GET', `/api/folders/${FOLDER.uid}`);
    if (found.status === 404) {
      const created = await call('POST', '/api/folders', FOLDER);
      if (!created.ok)
        throw new Error(
          `creating the folder ${FOLDER.title} answered ${reasonOf(created.status, created.body, token)}`,
        );
      lines.push(`created the folder ${FOLDER.title}`);
    } else if (!found.ok) {
      throw new Error(
        `reading the folder ${FOLDER.title} answered ${reasonOf(found.status, found.body, token)}`,
      );
    }

    let failed = 0;
    for (const { name, dashboard } of files) {
      const answer = await call('POST', '/api/dashboards/db', {
        dashboard: { ...dashboard, id: null },
        folderUid: FOLDER.uid,
        overwrite: true,
        message: `publish ${name} from the repository`,
      });
      if (answer.ok) {
        lines.push(`published ${name} (${dashboard.uid})`);
      } else {
        failed += 1;
        lines.push(`failed ${name}: ${reasonOf(answer.status, answer.body, token)}`);
      }
    }
    return { exitCode: failed === 0 ? 0 : 1, lines };
  } catch (error) {
    const reason = String(error?.message ?? error)
      .split(token)
      .join('[redacted]');
    return { exitCode: 1, lines: [...lines, `publish failed: ${reason.slice(0, MAX_REASON_LENGTH)}`] };
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const { exitCode, lines } = await publishDashboards({ env: process.env });
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.exitCode = exitCode;
}
