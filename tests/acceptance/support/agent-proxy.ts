// A recording proxy between the headless agent and the traced API (OBS-12). The agent sends every request with the
// `traceparent` of the span that opened it, so the proxy knows each request's trace id before the backend's search can
// find the trace. The proxy forwards bytes unchanged (the stream is long-lived, so the response is piped as it comes) and
// only keeps the method, the path, the traceparent, the content type and, for a JSON body, the names of its top-level keys
// (agent-trust, AGT-05). It never keeps a value of a body or a header other than those, except the type and the value of a chat
// sighting (server-name-match SNM-06), which a scenario sends with a made-up name.
import http from 'node:http';

/** One request the agent sent: its method, its path without the query string, and the traceparent it carried. */
export interface AgentRequestRecord {
  readonly method: string;
  readonly path: string;
  readonly traceparent: string | undefined;
  /** The `Content-Type` the request carried (media type only), or undefined. */
  readonly contentType?: string | undefined;
  /** The names of the top-level keys of a JSON object body, once the body was read; undefined for another body. */
  readonly bodyKeys?: readonly string[] | undefined;
  /**
   * The type and the value of a chat sighting (`PLAYER_JOINED_SEEN`, `PLAYER_LEFT_SEEN`) once its body was read (server-name-match
   * SNM-06). The scenarios send made-up names only; no other value of a body is ever kept.
   */
  readonly chat?: { readonly type: string; readonly value: unknown } | undefined;
}

/** What the proxy writes in a record once it has read the request. */
type MutableRecord = { -readonly [K in keyof AgentRequestRecord]: AgentRequestRecord[K] };

/** The largest body the proxy reads to name its keys. A larger one keeps no keys. */
const MAX_BODY_BYTES = 256 * 1024;

export interface RecordingProxy {
  /** `http://127.0.0.1:<port>`: the base URL the headless agent is given instead of the API's. */
  readonly url: string;
  /** Every request forwarded so far, in order. */
  requests(): readonly AgentRequestRecord[];
  /**
   * Writes `text` (server-sent event lines, ending with a blank line) into every open `GET /v1/stream` response, as if the
   * API had sent it. Returns how many streams got it. The test's way to hand the agent an event the API never sends.
   */
  injectIntoStream(text: string): number;
  /**
   * From now on, notes whether any request body carries `text` (compared in lower case, in any body of at most 256 KB, JSON
   * or not). Keeps the answer only, never a body: the way a scenario shows the agent never sent a name (agent-room-lifecycle).
   */
  watch(text: string): { carried(): boolean };
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
  const records: MutableRecord[] = [];
  const streams = new Set<http.ServerResponse>();
  const watched: { readonly needle: string; carried: boolean }[] = [];
  const server = http.createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const traceparent = request.headers['traceparent'];
    const contentType = request.headers['content-type'];
    const record: MutableRecord = {
      method: request.method ?? '',
      path: requestUrl.split('?')[0] ?? '/',
      traceparent: typeof traceparent === 'string' ? traceparent : undefined,
      contentType:
        typeof contentType === 'string' ? contentType.split(';')[0]?.trim().toLowerCase() : undefined,
    };
    records.push(record);
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (watched.length > 0 && size <= MAX_BODY_BYTES) {
        const body = Buffer.concat(chunks).toString('latin1').toLowerCase();
        for (const entry of watched) {
          if (body.includes(entry.needle)) entry.carried = true;
        }
      }
      if (record.contentType !== 'application/json' || size > MAX_BODY_BYTES) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          record.bodyKeys = Object.keys(value).sort();
          const type = (value as { type?: unknown }).type;
          if (type === 'PLAYER_JOINED_SEEN' || type === 'PLAYER_LEFT_SEEN') {
            record.chat = { type, value: (value as { value?: unknown }).value };
          }
        }
      } catch {
        // A body that is not JSON keeps no keys.
      }
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
        if (record.method === 'GET' && record.path === '/v1/stream') {
          streams.add(response);
          response.on('close', () => streams.delete(response));
        }
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
    injectIntoStream: (text) => {
      for (const response of streams) response.write(text);
      return streams.size;
    },
    watch: (text) => {
      const entry = { needle: text.toLowerCase(), carried: false };
      watched.push(entry);
      return { carried: () => entry.carried };
    },
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
