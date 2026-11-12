// Same-origin proxy for the API (ADR 012, AWS-29, design.md § Web). The site calls /api/*; this Function forwards the
// allow-listed headers to the API origin from the environment, streams the body and keeps Set-Cookie. A browser can
// never reach /__test/*, nor act as an agent through the site: Authorization and X-Agent-Version are dropped.

import { PREVIEW_API_ORIGIN, validPreviewApiOrigin } from './preview-origin.ts';

export interface ProxyEnv {
  API_ORIGIN: string;
}

export interface ProxyContext {
  request: Request;
  env: ProxyEnv;
  /** The preview API origin baked at build time (ADR 030); absent everywhere else. */
  previewApiOrigin?: string | undefined;
}

export type Upstream = (target: URL, init: RequestInit) => Promise<Response>;

const ALLOWED_REQUEST_HEADERS = [
  'cookie',
  'content-type',
  'accept',
  'accept-language',
  'last-event-id',
  'origin',
  'traceparent',
  'tracestate',
] as const;
const PATH_PATTERN = /^\/v1(\/[A-Za-z0-9_-]+)*$/;
const HEALTH_PATH = '/healthz';
/** A `tracestate` longer than this is dropped, not truncated: a partial vendor list would be a different list (OBS-09). */
const MAX_TRACESTATE_BYTES = 512;

/** Whether a request header is forwarded: on the allow-list, and a `tracestate` within its size bound. */
function forwardable(name: (typeof ALLOWED_REQUEST_HEADERS)[number], value: string): boolean {
  return name !== 'tracestate' || new TextEncoder().encode(value).byteLength <= MAX_TRACESTATE_BYTES;
}

// The API path behind an /api/* pathname, or null when the request must be refused. Encoded separators are refused
// before decoding, and decoded paths must match the allow-list, so a double-encoded separator never gets through.
export function apiPath(pathname: string): string | null {
  if (!pathname.startsWith('/api/')) {
    return null;
  }
  const raw = pathname.slice('/api'.length);
  if (/%2f|%5c|\\/i.test(raw)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('//') || decoded.includes('\\')) {
    return null;
  }
  return decoded === HEALTH_PATH || PATH_PATTERN.test(decoded) ? decoded : null;
}

export async function proxyRequest(context: ProxyContext, upstream: Upstream): Promise<Response> {
  const url = new URL(context.request.url);
  const path = apiPath(url.pathname);
  if (path === null) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // A baked preview API replaces API_ORIGIN only when it is well formed; anything else falls back to the environment.
  const target = new URL(validPreviewApiOrigin(context.previewApiOrigin) ?? context.env.API_ORIGIN);
  target.pathname = path;
  target.search = url.search;

  const headers = new Headers();
  for (const name of ALLOWED_REQUEST_HEADERS) {
    const value = context.request.headers.get(name);
    if (value !== null && forwardable(name, value)) {
      headers.set(name, value);
    }
  }
  const method = context.request.method;
  const init: RequestInit = { method, headers, redirect: 'manual' };
  // The browser leaving (an aborted stream or request) ends the upstream request too; without this the API keeps the stream.
  if (context.request.signal !== undefined) {
    init.signal = context.request.signal;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = context.request.body;
  }

  const answer = await upstream(target, init);
  // The upstream response is passed through whole: status, headers (Set-Cookie included) and a streamed body.
  const response = new Response(answer.body, answer);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function onRequest(context: ProxyContext): Promise<Response> {
  return proxyRequest({ ...context, previewApiOrigin: PREVIEW_API_ORIGIN }, (target, init) =>
    fetch(target, init),
  );
}
