// A Server-Sent Events client for the API's stream (ADR 007, `GET /v1/stream`): the site's stream (session cookie) and the
// agent's stream (bearer token). It keeps every event it receives, in order and with its id, so a scenario can wait for an
// event, close the stream, and reopen it from the last id it received (AWS-28). Black box: plain HTTP.

/** One event of the stream: its id (durable events carry the outbox id), its `event:` name and its JSON data. */
export interface StreamEvent {
  readonly id: string | undefined;
  readonly type: string;
  readonly data: unknown;
}

/** Splits one SSE block into its event. Comment-only blocks (keep-alives) carry no event. */
function parseBlock(block: string): StreamEvent | undefined {
  let id: string | undefined;
  let type: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') {
      id = value;
    } else if (field === 'event') {
      type = value;
    } else if (field === 'data') {
      data.push(value);
    }
  }
  if (type === undefined && data.length === 0) {
    return undefined;
  }
  const raw = data.join('\n');
  let parsed: unknown = raw;
  try {
    parsed = raw === '' ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    // A malformed payload is kept as text: the assertion that reads it reports what arrived.
  }
  return { id, type: type ?? 'message', data: parsed };
}

export class EventStream {
  /** The HTTP status the stream answered with. Only 200 streams carry events. */
  readonly status: number;
  /** Every event received so far, in arrival order. */
  readonly events: StreamEvent[] = [];
  readonly #abort: AbortController;
  #closed = false;
  #ended = false;

  private constructor(status: number, abort: AbortController) {
    this.status = status;
    this.#abort = abort;
  }

  /** Opens the stream. Resolves once the server has answered: a 200 stream is subscribed by then. */
  static async open(url: string, headers: Readonly<Record<string, string>> = {}): Promise<EventStream> {
    const abort = new AbortController();
    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream', ...headers },
      signal: abort.signal,
    });
    if (response.status !== 200 || response.body === null) {
      await response.body?.cancel().catch(() => undefined);
      return new EventStream(response.status, abort);
    }
    const stream = new EventStream(200, abort);
    void stream.#pump(response.body.getReader());
    return stream;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** True once the server ended the stream (for example after a revoke), or the connection failed. Not set by `close()`. */
  get ended(): boolean {
    return this.#ended;
  }

  /** The id of the last event that carries one: what a reconnect sends as `Last-Event-ID`. */
  lastId(): string | undefined {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const id = this.events[index]?.id;
      if (id !== undefined) {
        return id;
      }
    }
    return undefined;
  }

  /** Resolves with the first event (already received or arriving) that matches, or throws after `timeoutMs`. */
  async waitFor(matches: (event: StreamEvent) => boolean, timeoutMs = 2_000): Promise<StreamEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(matches);
      if (found !== undefined) {
        return found;
      }
      if (Date.now() >= deadline) {
        const received = this.events
          .map((event) => `${event.type}${event.id ? `#${event.id}` : ''}`)
          .join(', ');
        throw new Error(`no matching event within ${timeoutMs} ms; received: [${received}]`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Closes the connection. The events received so far stay readable. */
  close(): void {
    this.#closed = true;
    this.#abort.abort();
  }

  async #pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const event = parseBlock(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (event !== undefined) {
            this.events.push(event);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // The connection was closed (close(), a reset of the stack, or the end of the scenario). Nothing else to read.
    } finally {
      this.#ended = true;
    }
  }
}
