// The per-principal route limit (UPK-02, UPK-03): 60 a minute, Retry-After in whole seconds, no leak between principals or groups.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared-kernel/index.ts';
import { RelayLimiter } from './relay-limiter.ts';
import { ROUTE_LIMIT, ROUTE_WINDOW_MS, createRouteLimit, retryAfterSeconds } from './route-limit.ts';

const START = new Date('2026-11-02T12:00:00.000Z');

function setup() {
  const clock = new FakeClock(START);
  const limiter = new RelayLimiter(clock);
  const guard = createRouteLimit(limiter, clock, 'group', (request) => request.accountId);
  const other = createRouteLimit(limiter, clock, 'other', (request) => request.accountId);
  return { clock, guard, other };
}

/** A reply that records what it was sent. */
function replyDouble() {
  const sent: { code?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const reply = {
    code(code: number) {
      sent.code = code;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

const requestOf = (accountId: string | undefined) => ({ accountId }) as unknown as FastifyRequest;

describe('createRouteLimit', () => {
  it('allows 60 requests and refuses the 61st with 429, rate-limited and Retry-After', async () => {
    const { guard } = setup();
    for (let i = 0; i < ROUTE_LIMIT; i += 1) {
      const { reply, sent } = replyDouble();
      expect(await guard(requestOf('a'), reply)).toBeUndefined();
      expect(sent.code).toBeUndefined();
    }

    const { reply, sent } = replyDouble();
    await guard(requestOf('a'), reply);

    expect(sent.code).toBe(429);
    expect(sent.body).toEqual({ error: 'rate-limited' });
    expect(sent.headers['retry-after']).toBe('60');
  });

  it('keeps accounts and groups apart, and lets a principal in again once the window has passed', async () => {
    const { guard, other, clock } = setup();
    for (let i = 0; i <= ROUTE_LIMIT; i += 1) {
      await guard(requestOf('a'), replyDouble().reply);
    }

    const bob = replyDouble();
    expect(await guard(requestOf('b'), bob.reply)).toBeUndefined();
    const sameAccountOtherGroup = replyDouble();
    expect(await other(requestOf('a'), sameAccountOtherGroup.reply)).toBeUndefined();
    clock.advance(ROUTE_WINDOW_MS);
    const later = replyDouble();
    expect(await guard(requestOf('a'), later.reply)).toBeUndefined();
    expect(later.sent.code).toBeUndefined();
  });

  it('counts the refused requests too, so the wait runs from the last one that filled the window', async () => {
    const { guard, clock } = setup();
    for (let i = 0; i <= ROUTE_LIMIT; i += 1) {
      await guard(requestOf('a'), replyDouble().reply);
    }
    clock.advance(30_000);

    const { reply, sent } = replyDouble();
    await guard(requestOf('a'), reply);

    expect(sent.code).toBe(429);
    expect(sent.headers['retry-after']).toBe('30');
  });

  it('passes a request that has no principal', async () => {
    const { guard } = setup();
    for (let i = 0; i < ROUTE_LIMIT * 2; i += 1) {
      expect(await guard(requestOf(undefined), replyDouble().reply)).toBeUndefined();
    }
  });
});

describe('retryAfterSeconds', () => {
  it('rounds up to whole seconds and never answers less than 1', () => {
    const now = new Date('2026-11-02T12:00:00.000Z');
    expect(retryAfterSeconds(new Date(now.getTime() + 1), now)).toBe(1);
    expect(retryAfterSeconds(new Date(now.getTime() + 1000), now)).toBe(1);
    expect(retryAfterSeconds(new Date(now.getTime() + 1001), now)).toBe(2);
    expect(retryAfterSeconds(new Date(now.getTime() - 5000), now)).toBe(1);
    expect(retryAfterSeconds(new Date(now.getTime() + 60_000), now)).toBe(60);
  });
});
