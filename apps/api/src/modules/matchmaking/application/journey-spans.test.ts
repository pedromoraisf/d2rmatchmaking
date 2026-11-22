// The ids of the player's journey on the matchmaking spans (ADR 037, OBT-03): the account, the ticket and the ready check.
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queueSetup } from './testing/queue-setup.ts';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
});

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

function spanNamed(name: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find((finished) => finished.name === name);
  if (span === undefined) throw new Error(`no finished span named ${name}`);
  return span;
}

describe('matchmaking spans carry the journey ids (OBT-03)', () => {
  it('the join span carries the account and ticket ids, and the leave span the same ticket', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    const joined = await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    if (!joined.ok) throw new Error('join refused');

    const join = spanNamed('matchmaking.join').attributes;
    expect(join['d2r.account.id']).toBe('alice');
    expect(join['d2r.ticket.id']).toBe(joined.value.id);
    expect(join['d2r.queue.mode']).toBe('pvp');

    await t.queue.leaveQueue({ accountId: 'alice', ticketId: joined.value.id });
    const leave = spanNamed('matchmaking.leave').attributes;
    expect(leave['d2r.ticket.id']).toBe(joined.value.id);
    expect(leave['d2r.account.id']).toBe('alice');
  });

  it('the ready check spans carry the check id, and the answer span the account', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    const checkId = t.bus.readyChecksStarted()[0]?.readyCheckId;
    expect(checkId).toBeDefined();
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId: checkId ?? '', answer: 'accept' });

    expect(spanNamed('matchmaking.ready-check.open').attributes['d2r.ready_check.id']).toBe(checkId);
    const answer = spanNamed('matchmaking.ready-check.answer').attributes;
    expect(answer['d2r.ready_check.id']).toBe(checkId);
    expect(answer['d2r.account.id']).toBe('alice');
  });

  it('a refused join span still carries the mode and the difficulty asked for', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setLinked('alice', false);
    const refused = await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    expect(refused).toStrictEqual({ ok: false, error: 'not-linked' });

    const join = spanNamed('matchmaking.join').attributes;
    expect(join['d2r.queue.mode']).toBe('pvp');
    expect(join['d2r.difficulty']).toBe('hell');
  });

  it('the open span carries the mode and difficulty of the group, and the resolve span the check id', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    const checkId = t.bus.readyChecksStarted()[0]?.readyCheckId;

    const open = spanNamed('matchmaking.ready-check.open').attributes;
    expect(open['d2r.queue.mode']).toBe('pvp');
    expect(open['d2r.difficulty']).toBe('hell');

    t.clock.advance(60_000);
    await t.queue.runMatcher();
    expect(spanNamed('matchmaking.ready-check.resolve').attributes['d2r.ready_check.id']).toBe(checkId);
  });
});
