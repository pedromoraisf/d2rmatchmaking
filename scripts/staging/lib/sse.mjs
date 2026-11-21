// A Server-Sent Events reader for the bots (ADR 007): `GET /v1/stream`, with `Last-Event-ID` on a reconnect. It yields
// `{ id, type, data }` and ends when the stream or the abort signal ends. Comment lines (keep-alives) are skipped.

export function parseBlock(block) {
  let id;
  let type;
  const data = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  }
  if (type === undefined && data.length === 0) return undefined;
  let parsed;
  try {
    parsed = data.length === 0 ? undefined : JSON.parse(data.join('\n'));
  } catch {
    parsed = undefined;
  }
  return { id, type: type ?? 'message', data: parsed };
}

/** Opens a stream: resolves to `{ status, events }` where `events` is an async iterable (empty unless the status is 200). */
export async function openStream({ fetch: send, url, headers, signal }) {
  const response = await send(url, {
    headers: { Accept: 'text/event-stream', ...headers },
    signal,
    redirect: 'error',
  });
  if (response.status !== 200 || response.body === null) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, events: (async function* () {})() };
  }
  async function* events() {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
          const event = parseBlock(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (event !== undefined) yield event;
          end = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }
  return { status: 200, events: events() };
}
