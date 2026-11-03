// A recording proxy between the headless agent and the traced API (OBS-12). The agent sends every request with the
// `traceparent` of the span that opened it, so the proxy knows each request's trace id before the backend's search can
// find the trace. The proxy forwards bytes unchanged (the stream is long-lived, so the response is piped as it comes) and
// only keeps the method, the path and the traceparent of each request. It never keeps a body or a header other than that.
import http from 'node:http';

/** One request the agent sent: its method, its path without the query string, and the traceparent it carried. */
export interface AgentRequestRecord {
  readonly method: string;
  readonly path: string;
  readonly traceparent: string | undefined;
}

export interface RecordingProxy {
  /** `http://127.0.0.1:<port>`: the base URL the headless agent is given instead of the API's. */
  readonly url: string;
  /** Every request forwarded so far, in order. */
  requests(): readonly AgentRequestRecord[];
  /** Stops listening and closes the connections still open. */
  close(): Promise<void>;
}

/** The trace id of a W3C traceparent (`00-<32 hex>-<16 hex>-<flags>`). Throws when the value is not one. */
export function traceIdOf(traceparent: string | undefined): string {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-0[01]$/u.exec(traceparent ?? '');
  if (match?.[1] === undefined) {
    throw new Error(`the agent's request carried no valid traceparent (${traceparent ?? 'none'})`);
  }
  return match[1];
}

/** Starts the proxy on a free loopback port in front of `upstream` (an `http://` base URL). */
export async function startRecordingProxy(upstream: string): Promise<RecordingProxy> {
  const target = new URL(upstream);
  const records: AgentRequestRecord[] = [];
  const server = http.createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const traceparent = request.headers['traceparent'];
    records.push({
      method: request.method ?? '',
      path: requestUrl.split('?')[0] ?? '/',
      traceparent: typeof traceparent === 'string' ? traceparent : undefined,
    });
    const forward = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: requestUrl,
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        // The headers go out now, not with the first body chunk: an event stream sends no body until an event, and the agent's
        // call span (`agent.http.stream`) ends when the headers arrive, as it does without the proxy.
        response.flushHeaders();
        upstreamResponse.pipe(response);
      },
    );
    forward.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`recording proxy: ${error.message}`);
    });
    // A caller that drops the stream drops the forwarded request too, so the API sees the close as it would without the proxy.
    response.on('close', () => {
      if (!response.writableFinished) forward.destroy();
    });
    request.pipe(forward);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the recording proxy did not bind a loopback port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => [...records],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * Waits until the proxy has recorded a request that `matches`, and returns the latest one. Fails after `timeoutMs`, naming
 * the requests that were seen.
 */
export async function awaitRequest(
  proxy: RecordingProxy,
  what: string,
  matches: (record: AgentRequestRecord) => boolean,
  timeoutMs = 30_000,
): Promise<AgentRequestRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = proxy.requests().filter(matches).at(-1);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) {
      const seen = proxy
        .requests()
        .map((record) => `${record.method} ${record.path}`)
        .join(', ');
      throw new Error(`the agent sent no ${what} within ${timeoutMs} ms; it sent: [${seen || 'nothing'}]`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
