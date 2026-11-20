// The observation route's limit: 20 a minute for each agent, 40 a minute for each room, swept (security review of #101).
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import {
  AGENT_OBSERVATIONS_PER_MINUTE,
  ROOM_OBSERVATIONS_PER_MINUTE,
  createObservationLimit,
} from './observation-limit.ts';

const START = new Date('2026-11-20T12:00:00.000Z');
const MINUTE = 60 * 1000;

async function setup() {
  const clock = new FakeClock(START);
  const scheduler = new FakeScheduler(clock);
  const limit = createObservationLimit({ clock });
  const stop = limit.watch(scheduler);
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    // `requireAgent` has set the agent by the time the limit runs; the test says who is asking.
    const agent = request.headers['x-agent'];
    if (typeof agent === 'string') {
      request.agentId = agent;
    }
  });
  app.post('/v1/lobby-rooms/:id/observations', { preHandler: [limit.guard] }, async (_request, reply) =>
    reply.code(202).send({ stored: true }),
  );
  await app.ready();
  const post = (agent: string, room: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/lobby-rooms/${room}/observations`,
      headers: { 'x-agent': agent },
    });
  return { clock, scheduler, limit, stop, app, post };
}

let open: { app: { close(): Promise<unknown> }; stop(): void } | undefined;
afterEach(async () => {
  open?.stop();
  await open?.app.close();
  open = undefined;
});

describe('the observation limit', () => {
  it('lets an agent post 20 a minute and answers the 21st 429 with Retry-After', async () => {
    const world = await setup();
    open = world;
    for (let i = 0; i < AGENT_OBSERVATIONS_PER_MINUTE; i += 1) {
      expect((await world.post('agent-1', 'room-a')).statusCode, `request ${i + 1}`).toBe(202);
    }

    const refused = await world.post('agent-1', 'room-a');

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'rate-limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('counts each agent on its own and lets the first one back after the window', async () => {
    const world = await setup();
    open = world;
    for (let i = 0; i <= AGENT_OBSERVATIONS_PER_MINUTE; i += 1) {
      await world.post('agent-1', 'room-a');
    }
    expect((await world.post('agent-2', 'room-a')).statusCode).toBe(202);

    world.clock.advance(MINUTE + 1);

    expect((await world.post('agent-1', 'room-a')).statusCode).toBe(202);
  });

  it('caps a room at 40 a minute across its agents, and not another room', async () => {
    const world = await setup();
    open = world;
    for (let i = 0; i < ROOM_OBSERVATIONS_PER_MINUTE; i += 1) {
      const agent = `agent-${i % 4}`;
      expect((await world.post(agent, 'room-a')).statusCode, `request ${i + 1}`).toBe(202);
    }

    const refused = await world.post('agent-9', 'room-a');

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'rate-limited' });
    expect((await world.post('agent-9', 'room-b')).statusCode).toBe(202);
  });

  it('does nothing when no agent was authenticated (the auth guard has answered)', async () => {
    const world = await setup();
    open = world;
    const answer = await world.app.inject({ method: 'POST', url: '/v1/lobby-rooms/room-a/observations' });
    expect(answer.statusCode).toBe(202);
    expect(world.limit.keyCounts().principals).toBe(0);
  });

  it('sweeps the windows that expired, so the maps do not grow', async () => {
    const world = await setup();
    open = world;
    for (let i = 0; i < 50; i += 1) {
      await world.post(`agent-${i}`, `room-${i}`);
    }
    expect(world.limit.keyCounts().principals).toBe(100);

    world.clock.advance(MINUTE + 30 * 1000);

    expect(world.limit.keyCounts().principals).toBe(0);
  });
});
