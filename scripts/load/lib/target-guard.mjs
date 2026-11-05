// Refuses any target or Docker host the run did not start (LB-17; AD-117; design.md § Error Handling Strategy). Pure: the
// environment is a plain object passed in, never `process.env`. A refusal names the variable and never echoes its value,
// which may hold a secret.

const TARGET_VARIABLES = ['LOAD_TARGET', 'DATABASE_URL'];
const LOCAL_UNIX_SOCKET = /^unix:\/\/\/\S+$/;

function refusal(variable, message) {
  return { variable, message };
}

/**
 * Refuses a non-empty `LOAD_TARGET` or `DATABASE_URL`, loopback values included: the run starts its own containers.
 * An unset or empty variable is ignored.
 * @param {Record<string, string | undefined>} env
 * @returns {{ variable: string, message: string } | null}
 */
export function guardTarget(env) {
  for (const variable of TARGET_VARIABLES) {
    const value = env[variable];
    if (value !== undefined && value !== '') {
      return refusal(
        variable,
        `${variable} is set: the load run starts its own containers and refuses any other target; unset ${variable}`,
      );
    }
  }
  return null;
}

/**
 * Refuses a `DOCKER_HOST` that is not a local unix socket, a `DOCKER_CONTEXT` other than empty or `default`, and any set
 * `OTEL_*` variable: each would send the run to a daemon or a collector it did not start (AD-117).
 * @param {Record<string, string | undefined>} env
 * @returns {{ variable: string, message: string } | null}
 */
export function guardDocker(env) {
  const host = env['DOCKER_HOST'];
  if (host !== undefined && host !== '' && !LOCAL_UNIX_SOCKET.test(host)) {
    return refusal(
      'DOCKER_HOST',
      'DOCKER_HOST is not a local unix socket: the load run only uses the Docker daemon on this machine; unset DOCKER_HOST',
    );
  }
  const context = env['DOCKER_CONTEXT'];
  if (context !== undefined && context !== '' && context !== 'default') {
    return refusal(
      'DOCKER_CONTEXT',
      'DOCKER_CONTEXT is not the default: the load run only uses the default Docker context; unset DOCKER_CONTEXT',
    );
  }
  const otel = Object.keys(env)
    .filter((name) => name.startsWith('OTEL_') && env[name] !== undefined)
    .sort()[0];
  if (otel !== undefined) {
    return refusal(
      otel,
      `${otel} is set: an inherited OpenTelemetry variable would send data to a collector the run did not start; unset ${otel}`,
    );
  }
  return null;
}
