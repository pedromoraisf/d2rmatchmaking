// The site's live stream (ADR 007): one EventSource on /api/v1/stream. Each event arrives under its `type` as the SSE
// name and its JSON as `data`; a malformed event is dropped, never shown.
import { SiteStreamEvent } from '@d2rmm/contracts';

export interface SiteStreamHandlers {
  onOpen(): void;
  onEvent(event: SiteStreamEvent): void;
}

export interface StreamSource {
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void): void;
  close(): void;
}

export type StreamOpener = (handlers: SiteStreamHandlers) => () => void;

export const STREAM_URL = '/api/v1/stream';
// Every event of the contract's site stream is listened to: a type missing here would never reach the site (CHR-12).
const EVENT_TYPES = SiteStreamEvent.options.map((option) => option.shape.type.value);

function parseEvent(type: string, data: string): SiteStreamEvent | null {
  try {
    return SiteStreamEvent.parse({ type, data: JSON.parse(data) });
  } catch {
    return null;
  }
}

// Returns the close function. Every `open` (the first one and each reconnect) reaches onOpen, so the caller re-reads
// the state the stream may have missed.
export function openSiteStream(
  handlers: SiteStreamHandlers,
  connect: (url: string) => StreamSource = (url) => new EventSource(url),
): () => void {
  const source = connect(STREAM_URL);
  source.addEventListener('open', () => {
    handlers.onOpen();
  });
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      const event = parseEvent(type, message.data);
      if (event !== null) {
        handlers.onEvent(event);
      }
    });
  }
  return () => {
    source.close();
  };
}
