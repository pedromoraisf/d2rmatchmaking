// The staging guard (staging-bots SBT-02). It decides whether the script may touch an API, and it does so before the first
// write: the only requests it makes are `GET /healthz` and `GET /v1/config`. Pure over an injected `fetch`.

export class TargetRefusal extends Error {}

function originOf(value, what) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TargetRefusal(`${what} is not a URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
    throw new TargetRefusal(`${what} must be https`);
  }
  if (
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new TargetRefusal(`${what} is an origin only`);
  }
  return url.origin;
}

/**
 * Refuses every target that is not the staging API.
 * @param {{ apiUrl: string | undefined, expectedUrl: string | undefined, environment: string | undefined, fetch: typeof fetch }} input
 *   `apiUrl` is the target; `expectedUrl` is the `STAGING_API_URL` variable of the `staging` environment; `environment` is
 *   `D2RMM_ENV` as the process sees it.
 * @returns {Promise<{ origin: string, minAgentVersion: string }>}
 */
export async function assertStaging({ apiUrl, expectedUrl, environment, fetch: send }) {
  if (environment === 'production') {
    throw new TargetRefusal('D2RMM_ENV is production: the bots never run there');
  }
  if (apiUrl === undefined || expectedUrl === undefined || apiUrl === '' || expectedUrl === '') {
    throw new TargetRefusal('STAGING_API_URL is not set: the target comes only from the staging environment');
  }
  const origin = originOf(apiUrl, 'the API URL');
  if (origin !== originOf(expectedUrl, 'STAGING_API_URL')) {
    throw new TargetRefusal("the API URL is not the staging environment's STAGING_API_URL");
  }
  let config;
  try {
    const health = await send(`${origin}/healthz`, { method: 'GET', redirect: 'error' });
    if (health.status !== 200) {
      throw new TargetRefusal(`/healthz answered ${health.status}`);
    }
    const answer = await send(`${origin}/v1/config`, { method: 'GET', redirect: 'error' });
    if (answer.status !== 200) {
      throw new TargetRefusal(`/v1/config answered ${answer.status}`);
    }
    config = await answer.json();
  } catch (error) {
    if (error instanceof TargetRefusal) throw error;
    throw new TargetRefusal(
      `the target could not be checked: ${error instanceof Error ? error.message : 'unreachable'}`,
    );
  }
  if (config?.stagingEndpoints !== true) {
    throw new TargetRefusal('/v1/config does not say stagingEndpoints: true, so this is not a staging API');
  }
  const minAgentVersion = typeof config.minAgentVersion === 'string' ? config.minAgentVersion : '0.0.1';
  return { origin, minAgentVersion };
}
