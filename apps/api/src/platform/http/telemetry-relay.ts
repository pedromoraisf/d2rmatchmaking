// The telemetry relay route (OBS-10, OBS-13, OBS-14, OBS-20; design § Relay route). `POST /v1/telemetry/traces` takes OTLP/HTTP
// from an agent token or a site session. Every refusal is decided before Fastify reads the body, in this order:
//   1. authentication: no credential counts in the address bucket (429 over its limit, else 401); a credential is checked by
//      the guard (401 unauthenticated, 429 lookup throttled, 403 wrong origin); a failed one counts in the address bucket;
//   2. rate per account: 60 requests a minute, then the byte and daily budgets (429 with Retry-After);
//   3. content type `application/x-protobuf` or `application/json`, and a content encoding of `identity` (415);
//   4. a declared length over 1 MiB (413).
// The streamed bytes are charged as they arrive, so a chunked body is cut off at the first chunk past its budget. The
// relay then answers an empty 202 and forwards the body in the background; a refused or dropped body gives its bytes back.
import { Transform, pipeline, type Readable } from 'node:stream';
import { ErrorResponse, RelayAccepted } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock, Scheduler } from '../../shared-kernel/index.ts';
import { sessionCookieValue, type Guards } from './guards.ts';
import { ACCOUNT_REQUESTS_PER_MINUTE, type RelayBudget } from './relay-budget.ts';
import type { Forwarder } from './relay-forwarder.ts';
import type { RelayLimiter } from './relay-limiter.ts';

export const RELAY_PATH = '/v1/telemetry/traces';
/** The largest body the relay accepts, declared or streamed (OBS-13). */
export const RELAY_BODY_LIMIT_BYTES = 1024 * 1024;
/** How long a body may take to arrive; a slower connection is closed so it cannot hold the in-flight caps. */
export const RELAY_BODY_READ_TIMEOUT_MS = 10_000;

const CONTENT_TYPES: ReadonlySet<string> = new Set(['application/x-protobuf', 'application/json']);
const MINUTE_MS = 60 * 1000;

export interface TelemetryRelayDeps {
  readonly guards: Pick<Guards, 'requireAgentOrSite'>;
  readonly limiter: RelayLimiter;
  readonly budget: RelayBudget;
  readonly forwarder: Forwarder;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
}

/** The bytes one request charged to its account, kept until the request is answered. */
interface Charge {
  readonly accountId: string;
  bytes: number;
}

/** The media type of a `Content-Type` value, lower-case and without parameters. */
function mediaTypeOf(value: string | undefined): string | undefined {
  return value?.split(';')[0]?.trim().toLowerCase();
}

/** A content encoding is absent or `identity`; gzip and every other encoding are refused (no decompression path). */
function isIdentityEncoding(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === 'identity';
}

function secondsUntil(clock: Clock, at: Date): number {
  return Math.max(1, Math.ceil((at.getTime() - clock.now().getTime()) / 1000));
}

function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply.code(429).header('retry-after', String(retryAfterSeconds)).send({ error: 'rate-limited' });
}

/** The relay plugin: registered once by `buildApp`, its parsers and hooks scoped to the relay route only. */
export async function telemetryRelayPlugin(app: FastifyInstance, deps: TelemetryRelayDeps): Promise<void> {
  const { guards, limiter, budget, forwarder, clock } = deps;
  const charges = new WeakMap<FastifyRequest, Charge>();

  // The two content types arrive as bytes, unchanged. Anything else was refused in `admit` before a parser runs.
  app.addContentTypeParser(
    [...CONTENT_TYPES],
    { parseAs: 'buffer', bodyLimit: RELAY_BODY_LIMIT_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  const stopSweep = limiter.watch(deps.scheduler);
  app.addHook('onClose', (_instance, done) => {
    stopSweep();
    done();
  });

  /** Checks authentication, rate, content type and encoding, and declared size, in that order. */
  async function admit(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const address = request.ip;
    if (
      request.headers.authorization === undefined &&
      sessionCookieValue(request.headers.cookie) === undefined
    ) {
      const counted = limiter.arriveFromAddress(address);
      if (counted.outcome === 'limited') {
        return tooManyRequests(reply, secondsUntil(clock, counted.retryAt));
      }
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const answered = await guards.requireAgentOrSite(request, reply);
    if (answered !== undefined) {
      if (reply.statusCode === 401 || reply.statusCode === 429) {
        limiter.arriveFromAddress(address);
      }
      return answered;
    }

    const accountId = request.agentAccountId ?? request.accountId;
    if (accountId === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const principal = limiter.arriveAsPrincipal(
      `account:${accountId}`,
      ACCOUNT_REQUESTS_PER_MINUTE,
      MINUTE_MS,
    );
    if (principal.outcome === 'limited') {
      return tooManyRequests(reply, secondsUntil(clock, principal.retryAt));
    }
    const verdict = budget.admit(accountId);
    if (verdict.outcome === 'refused') {
      return tooManyRequests(reply, verdict.retryAfterSeconds);
    }

    const contentType = mediaTypeOf(request.headers['content-type']);
    if (
      contentType === undefined ||
      !CONTENT_TYPES.has(contentType) ||
      !isIdentityEncoding(request.headers['content-encoding'])
    ) {
      return reply.code(415).send({ error: 'unsupported-media-type' });
    }
    if (Number(request.headers['content-length'] ?? 0) > RELAY_BODY_LIMIT_BYTES) {
      return reply.code(413).send({ error: 'payload-too-large' });
    }
    return undefined;
  }

  /** Charges the streamed bytes to the account and the relay, and times the body read out. */
  async function meter(request: FastifyRequest, reply: FastifyReply, payload: Readable): Promise<Readable> {
    const accountId = request.agentAccountId ?? request.accountId;
    if (accountId === undefined) {
      return payload;
    }
    const charge: Charge = { accountId, bytes: 0 };
    charges.set(request, charge);
    const timer = setTimeout(() => {
      request.raw.destroy();
    }, RELAY_BODY_READ_TIMEOUT_MS);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const verdict = budget.charge(accountId, chunk.byteLength);
        if (verdict.outcome === 'refused') {
          reply.header('retry-after', String(verdict.retryAfterSeconds));
          callback(Object.assign(new Error('relay budget exhausted'), { statusCode: 429 }));
          return;
        }
        charge.bytes += chunk.byteLength;
        callback(null, chunk);
      },
    });
    counter.once('close', () => {
      clearTimeout(timer);
    });
    pipeline(payload, counter, () => undefined);
    return counter;
  }

  // A request that is not answered `202` gives back the bytes it charged (refused later, or failed while it streamed).
  app.addHook('onResponse', async (request) => {
    const charge = charges.get(request);
    if (charge !== undefined) {
      charges.delete(request);
      budget.refund(charge.accountId, charge.bytes);
    }
  });

  app.post(
    RELAY_PATH,
    {
      bodyLimit: RELAY_BODY_LIMIT_BYTES,
      onRequest: admit,
      preParsing: meter,
      schema: {
        response: {
          202: RelayAccepted,
          401: ErrorResponse,
          403: ErrorResponse,
          413: ErrorResponse,
          415: ErrorResponse,
          429: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const contentType = mediaTypeOf(request.headers['content-type']) ?? 'application/octet-stream';
      const charge = charges.get(request);
      charges.delete(request);
      if (forwarder.dropped(body.byteLength) && charge !== undefined) {
        budget.refund(charge.accountId, charge.bytes);
      }
      // Never awaited: a backend failure must not change the caller's answer (OBS-15).
      void forwarder.forward(body, contentType);
      return reply.code(202).send();
    },
  );
}
