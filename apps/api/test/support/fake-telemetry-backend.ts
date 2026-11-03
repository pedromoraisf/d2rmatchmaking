// A fake OTLP/HTTP backend on loopback for the relay tests (OBS-15, OBS-16). It records every request it receives and
// answers with the configured status, headers and body. The relay never reads the answer, so the tests use it to prove
// that nothing of the answer reaches the caller or a log.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface BackendAnswer {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface FakeTelemetryBackend {
  /** The base URL the relay forwards to (`OTEL_EXPORTER_OTLP_ENDPOINT`). */
  readonly url: string;
  /** Every request received so far, in arrival order. */
  requests(): readonly RecordedRequest[];
  /** The answer to every request from now on. */
  answerWith(answer: BackendAnswer): void;
  /** Resolves once `count` requests have arrived; rejects after `timeoutMs`. */
  waitForRequests(count: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Starts a fake backend on a free loopback port. */
export async function startFakeTelemetryBackend(): Promise<FakeTelemetryBackend> {
  const received: RecordedRequest[] = [];
  let answer: BackendAnswer = { status: 200 };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(answer.status, answer.headers ?? {});
      response.end(answer.body ?? '');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => [...received],
    answerWith: (next) => {
      answer = next;
    },
    waitForRequests: async (count, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (received.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`the backend received ${received.length} of ${count} requests`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

/** A loopback URL with nothing listening on it: the port was bound, then released. */
export async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return `http://127.0.0.1:${port}`;
}
