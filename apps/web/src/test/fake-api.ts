// Test doubles for the API and the stream. They live under test/, which the architecture rule exempts from the
// runtime dependency check, so they may import the test libraries.
import type { Fetcher } from '../shared/api-client.ts';
import type { StreamSource } from '../shared/stream.ts';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Answers by "METHOD /url" and records every call. An unlisted route answers 404.
export function routeFetch(routes: Record<string, () => Response>): {
  fetch: Fetcher;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const route = routes[`${init.method ?? 'GET'} ${url}`];
    return route === undefined ? jsonResponse(404) : route();
  };
  return { fetch, calls };
}

export function fakeSource(): {
  source: StreamSource;
  connect: (url: string) => StreamSource;
  urls: string[];
  closed: () => number;
  emit: (type: string, data?: string) => void;
} {
  const listeners = new Map<string, Array<(message: MessageEvent<string>) => void>>();
  const urls: string[] = [];
  let closes = 0;
  const source: StreamSource = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      closes += 1;
    },
  };
  return {
    source,
    connect: (url) => {
      urls.push(url);
      return source;
    },
    urls,
    closed: () => closes,
    emit: (type, data = '') => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data } as MessageEvent<string>);
      }
    },
  };
}
