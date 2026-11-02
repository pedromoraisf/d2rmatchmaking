// The local observability backend for the trace scenarios (OBS-24, OBS-25). The helper runs the image that
// `infra/observability/compose.yaml` pins, so the acceptance run and `pnpm obs:up` use one image. Docker is required:
// a missing socket fails the step by name, and no scenario falls back to a fake backend.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.resolve(here, '..', '..', '..', 'infra', 'observability', 'compose.yaml');

/** Tempo's query API inside the image (published on 3200 by compose). */
const TEMPO_PORT = 3200;
/** The OTLP/HTTP receiver inside the image (published on 4318 by compose). */
const OTLP_HTTP_PORT = 4318;
const STARTUP_TIMEOUT_MS = 240_000;

export interface TelemetryBackend {
  /** Tempo's query API, for `readTrace`. */
  readonly queryUrl: string;
  /** The OTLP/HTTP receiver the traced stack exports to. */
  readonly otlpUrl: string;
  stop(): Promise<void>;
}

/** The image reference of the `lgtm` service in the compose text, digest included. */
export function imageFromCompose(composeText: string): string {
  const image = /^\s*image:\s*(\S+)\s*$/mu.exec(composeText)?.[1];
  if (image === undefined) {
    throw new Error('infra/observability/compose.yaml names no image for the telemetry backend');
  }
  return image;
}

/** The socket a `unix://` DOCKER_HOST names, or undefined when the variable is unset or names another transport. */
function dockerHostSocket(): string | undefined {
  const host = process.env['DOCKER_HOST'];
  return host?.startsWith('unix://') ? host.slice('unix://'.length) : undefined;
}

/** Starts the backend and waits until Tempo answers its readiness check. Throws an error that names Docker when it cannot. */
export async function startTelemetryBackend(): Promise<TelemetryBackend> {
  const socket = dockerHostSocket();
  if (socket !== undefined && !existsSync(socket)) {
    throw new Error(
      `Docker is not running: no socket at ${socket} (DOCKER_HOST). Start Docker to run the trace scenarios.`,
    );
  }

  const image = imageFromCompose(readFileSync(COMPOSE_FILE, 'utf8'));
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(image)
      .withExposedPorts(TEMPO_PORT, OTLP_HTTP_PORT)
      .withWaitStrategy(Wait.forHttp('/ready', TEMPO_PORT).forStatusCode(200))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Docker could not start the telemetry backend (${image}): ${reason}`, { cause: error });
  }

  const host = container.getHost();
  return {
    queryUrl: `http://${host}:${container.getMappedPort(TEMPO_PORT)}`,
    otlpUrl: `http://${host}:${container.getMappedPort(OTLP_HTTP_PORT)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
