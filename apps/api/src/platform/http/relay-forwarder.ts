// The relay's forwarder (OBS-15, OBS-16, design § Relay route). The relay answers `202` first and calls `forward` without
// awaiting it, so a backend failure never changes the caller's answer. The forward carries the body unchanged, the content
// type and the backend credentials only: never the caller's address, user agent or cookies. It is never retried.
import type { ErrorLog } from '../error-log.ts';

export const MAX_FORWARDS_IN_FLIGHT = 32;
export const MAX_BYTES_IN_FLIGHT = 8 * 1024 * 1024;
export const FORWARD_TIMEOUT_MS = 5000;

/** The subset of `fetch` the forwarder uses; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ForwarderDeps {
  /** The backend's base URL (`OTEL_EXPORTER_OTLP_ENDPOINT`), or undefined: then every forward is dropped. */
  readonly endpoint: string | undefined;
  /** The backend's credential headers (`OTEL_EXPORTER_OTLP_HEADERS`). Logged never. */
  readonly credentials: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
  /** The platform's error sink: one line per failed or dropped forward, with no body, headers or credentials. */
  readonly log: ErrorLog;
}

/** The class name of a thrown value, or `unknown`: a message can carry a credential, so it is never logged. */
function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export class Forwarder {
  readonly #deps: ForwarderDeps;
  #inFlight = 0;
  #bytesInFlight = 0;

  constructor(deps: ForwarderDeps) {
    this.#deps = deps;
  }

  /**
   * Posts `body` to the backend in the background. The promise never rejects: a failure is logged and dropped. It is
   * safe to call without awaiting it.
   */
  forward(body: Uint8Array, contentType: string): Promise<void> {
    const endpoint = this.#deps.endpoint;
    if (endpoint === undefined) {
      return Promise.resolve();
    }
    if (
      this.#inFlight >= MAX_FORWARDS_IN_FLIGHT ||
      this.#bytesInFlight + body.byteLength > MAX_BYTES_IN_FLIGHT
    ) {
      this.#deps.log.error('relay-forward-dropped reason=in-flight-cap');
      return Promise.resolve();
    }
    this.#inFlight += 1;
    this.#bytesInFlight += body.byteLength;
    return this.#send(endpoint, body, contentType).finally(() => {
      this.#inFlight -= 1;
      this.#bytesInFlight -= body.byteLength;
    });
  }

  async #send(endpoint: string, body: Uint8Array, contentType: string): Promise<void> {
    const url = `${endpoint.replace(/\/+$/, '')}/v1/traces`;
    let response: Response;
    try {
      response = await this.#deps.fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
        headers: { 'content-type': contentType, ...this.#deps.credentials },
        body,
      });
    } catch (error) {
      this.#deps.log.error(`relay-forward-failed error=${errorClassOf(error)}`);
      return;
    }
    try {
      if (response.status < 200 || response.status > 299) {
        this.#deps.log.error(`relay-forward-failed status=${response.status}`);
      }
    } finally {
      await cancelBody(response);
    }
  }
}

/** Cancels the backend response body so an endless body holds no socket. A body that cannot be cancelled is ignored. */
async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already locked or closed: nothing is left to release.
  }
}
