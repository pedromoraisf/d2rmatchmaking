// One bot (staging-bots SBT-05, SBT-06, SBT-07): a test account with a paired fake agent. It speaks only the real contract:
// the same routes, headers and bodies a player's site and a real agent send, each body checked by the contract's schema
// before it leaves. State lives in this object, in memory; nothing is written anywhere.
import {
  Heartbeat,
  Observation,
  RecordCharactersRequest,
  DeclareCharacterRequest,
  TestLoginRequest,
} from '../../../packages/contracts/src/index.ts';
import { RateLimited, sessionCookieOf } from './http.mjs';
import { openStream } from './sse.mjs';

const HEARTBEAT_EVERY_MS = 15_000;
const CLAIM_POLL_MS = 1_000;
const CLAIM_POLLS = 30;
const ACCEPT_DELAY_MS = [2_000, 10_000];
const GAME_WINDOW = 'Diablo II: Resurrected';
const ENDED_STAGES = new Set(['closed', 'expired']);

export class BotError extends Error {}

function parsed(schema, value, what) {
  const result = schema.safeParse(value);
  if (!result.success) throw new BotError(`${what} does not match the contract`);
  return result.data;
}

export function createBot({
  member,
  plan,
  client,
  base,
  fetch: send,
  log,
  sleep,
  random,
  now = () => new Date(),
  signal,
}) {
  const name = member.name;
  const state = {
    cookie: undefined,
    token: undefined,
    accountId: undefined,
    agentId: undefined,
    characterId: undefined,
    ticketId: undefined,
    roomId: undefined,
    run: undefined,
    stage: undefined,
    stages: [],
    pcState: 'IDLE',
    ended: false,
  };
  const abort = new AbortController();
  const relay = () => abort.abort();
  signal?.addEventListener('abort', relay, { once: true });
  const tasks = [];
  let onEnded;
  const ended = new Promise((resolve) => {
    onEnded = resolve;
  });

  function say(event, fields = {}) {
    log.line(event, { bot: name, ...fields });
  }

  async function provision() {
    const login = await client.call('/v1/auth/test-login', {
      method: 'POST',
      headers: { Origin: client.origin },
      body: parsed(TestLoginRequest, { name }, 'the sign-in'),
    });
    if (login.status !== 200) throw new BotError(`${name}: test-login answered ${login.status}`);
    state.cookie = sessionCookieOf(login.headers);
    log.secret(state.cookie.split('=')[1]);
    state.accountId = login.body.accountId;

    const issued = await client.call('/v1/agents/pairing-codes', {
      method: 'POST',
      headers: { 'X-Agent-Version': client.version },
      noBackoff: true,
    });
    if (issued.status !== 201) throw new BotError(`${name}: the pairing code answered ${issued.status}`);
    const { code, claimSecret } = issued.body;
    log.secret(claimSecret);
    const paired = await client.site('/v1/agents/pair', state.cookie, { method: 'POST', body: { code } });
    if (paired.status !== 200 && paired.status !== 204)
      throw new BotError(`${name}: pair answered ${paired.status}`);
    for (let poll = 1; poll <= CLAIM_POLLS; poll += 1) {
      const claim = await client.call('/v1/agents/pairing-codes/claim', {
        method: 'POST',
        headers: { 'X-Agent-Version': client.version },
        body: { claimSecret },
      });
      if (claim.status === 200) {
        state.token = claim.body.token;
        log.secret(state.token);
        break;
      }
      if (claim.status !== 202) throw new BotError(`${name}: the claim answered ${claim.status}`);
      await sleep(CLAIM_POLL_MS);
    }
    if (state.token === undefined) throw new BotError(`${name}: the claim stayed pending`);

    const me = await client.site('/v1/agents/me', state.cookie);
    if (me.status === 200 && me.body?.status === 'paired') state.agentId = me.body.agentId;
    if (state.agentId === undefined) throw new BotError(`${name}: the paired agent is not listed`);

    const recorded = await client.agent('/v1/me/characters', state.token, {
      method: 'POST',
      body: parsed(RecordCharactersRequest, { characters: [member.character] }, 'the character batch'),
    });
    if (recorded.status !== 200 && recorded.status !== 204 && recorded.status !== 201) {
      throw new BotError(`${name}: the character batch answered ${recorded.status}`);
    }
    const listed = await client.site('/v1/me/characters', state.cookie);
    const mine = listed.body?.characters?.find((character) => character.name === member.character.name);
    if (mine === undefined) throw new BotError(`${name}: the character is not listed`);
    state.characterId = mine.id;
    const declared = await client.site(`/v1/me/characters/${encodeURIComponent(mine.id)}`, state.cookie, {
      method: 'PATCH',
      body: parsed(DeclareCharacterRequest, member.declaration, 'the declaration'),
    });
    if (declared.status !== 200 && declared.status !== 204) {
      throw new BotError(`${name}: the declaration answered ${declared.status}`);
    }
    say('bot.provisioned');
  }

  async function heartbeat() {
    const body = parsed(
      Heartbeat,
      {
        agentVersion: client.version,
        pcState: state.pcState,
        game: { running: true, window: GAME_WINDOW, screen: 'UNKNOWN' },
        ...(state.roomId === undefined ? {} : { assignment: { roomId: state.roomId, run: state.run } }),
        // Nothing is captured: a bot says so, with the words a real agent uses for "no method".
        capture: { method: 'none', readRate: 0 },
      },
      'the heartbeat',
    );
    const answer = await client.agent('/v1/agents/heartbeat', state.token, { method: 'POST', body });
    if (answer.status !== 200 && answer.status !== 204)
      say('bot.heartbeat-refused', { status: answer.status });
  }

  function keepAlive(work, every) {
    tasks.push(
      (async () => {
        while (!abort.signal.aborted) {
          try {
            await work();
          } catch (error) {
            say('bot.task-failed', { reason: error instanceof Error ? error.message : 'failed' });
          }
          await sleep(every, abort.signal);
        }
      })(),
    );
  }

  function holdStream(label, headers, handle) {
    tasks.push(
      (async () => {
        let lastId;
        while (!abort.signal.aborted) {
          try {
            const stream = await openStream({
              fetch: send,
              url: `${base}/v1/stream`,
              headers: { ...headers, ...(lastId === undefined ? {} : { 'Last-Event-ID': lastId }) },
              signal: abort.signal,
            });
            if (stream.status !== 200) throw new BotError(`the ${label} stream answered ${stream.status}`);
            for await (const event of stream.events) {
              if (event.id !== undefined) lastId = event.id;
              await handle(event);
            }
          } catch (error) {
            if (abort.signal.aborted) return;
            say('bot.stream-failed', {
              stream: label,
              reason: error instanceof Error ? error.message : 'failed',
            });
          }
          await sleep(2_000, abort.signal);
        }
      })(),
    );
  }

  async function observe(assignment) {
    const body = parsed(
      Observation,
      {
        idempotencyKey: `${name}-${assignment.roomId}-${assignment.run}`.slice(0, 64),
        type: 'GAME_NAME_SEEN',
        run: assignment.run,
        value: assignment.expectedGameName,
        confidence: 0.99,
        capturedAt: now().toISOString(),
      },
      'the observation',
    );
    const answer = await client.agent(
      `/v1/lobby-rooms/${encodeURIComponent(assignment.roomId)}/observations`,
      state.token,
      { method: 'POST', body },
    );
    say('bot.observed', { status: answer.status });
  }

  let assignment;
  async function onAgentEvent(event) {
    if (event.type === 'ready_check.started') {
      const [low, high] = ACCEPT_DELAY_MS;
      await sleep(low + random() * (high - low), abort.signal);
      const answer = await client.agent(
        `/v1/ready-checks/${encodeURIComponent(event.data.id)}/accept`,
        state.token,
        {
          method: 'POST',
          body: {},
        },
      );
      say('bot.accepted', { status: answer.status });
    } else if (event.type === 'room.assigned' || event.type === 'room.run_opened') {
      assignment = event.data;
      state.roomId = assignment.roomId;
      state.run = assignment.run;
      state.pcState = 'IN_ROOM_JOINING';
      state.ticketId = undefined;
      const host = assignment.members.find((member) => member.accountId === state.accountId)?.role === 'host';
      say('bot.assigned', { room: assignment.roomId, host });
      if (host && plan.hostPolicy === 'bot-reports') await observe(assignment);
    } else if (event.type === 'room.stage_changed' && event.data.roomId === state.roomId) {
      state.stage = event.data.stage;
      state.stages.push(event.data.stage);
      say('bot.stage', { stage: event.data.stage });
      if (event.data.stage === 'created' && assignment !== undefined) {
        const host =
          assignment.members.find((member) => member.accountId === state.accountId)?.role === 'host';
        if (!host) await observe(assignment);
      }
      if (ENDED_STAGES.has(event.data.stage)) {
        state.ended = true;
        state.pcState = 'IDLE';
        onEnded();
      }
    }
  }

  async function join() {
    const body = { ...plan.queue, characterId: state.characterId };
    const answer = await client.site('/v1/queue/tickets', state.cookie, { method: 'POST', body });
    if (answer.status === 201) {
      state.ticketId = answer.body?.id;
      state.pcState = 'IN_QUEUE';
      say('bot.queued');
    } else if (answer.status === 409) {
      say('bot.already-queued');
    } else {
      throw new BotError(`${name}: the join answered ${answer.status}`);
    }
  }

  /** The number the site shows as "N jogadores nesta fila", or undefined when the bot holds no ticket. */
  async function poolSize() {
    const answer = await client.site('/v1/queue/tickets/me', state.cookie);
    return answer.status === 200 ? answer.body?.ticket?.poolSize : undefined;
  }

  function start() {
    keepAlive(heartbeat, HEARTBEAT_EVERY_MS);
    holdStream('site', { Cookie: state.cookie }, async () => undefined);
    holdStream(
      'agent',
      { Authorization: `Bearer ${state.token}`, 'X-Agent-Version': client.version },
      onAgentEvent,
    );
  }

  /** The leave steps of SBT-10, in order. Each is safe to run when its subject is gone. */
  function leaveSteps() {
    return [
      [
        'room-or-ticket',
        async () => {
          if (state.roomId !== undefined && !state.ended) {
            await client.site(`/v1/lobby-rooms/${encodeURIComponent(state.roomId)}/leave`, state.cookie, {
              method: 'POST',
              body: {},
            });
          } else if (state.ticketId !== undefined) {
            await client.site(`/v1/queue/tickets/${encodeURIComponent(state.ticketId)}`, state.cookie, {
              method: 'DELETE',
            });
          }
        },
      ],
      [
        'agent',
        async () => {
          if (state.agentId !== undefined && state.cookie !== undefined) {
            const answer = await client.site(
              `/v1/agents/${encodeURIComponent(state.agentId)}`,
              state.cookie,
              {
                method: 'DELETE',
              },
            );
            if (answer.status !== 204 && answer.status !== 404)
              throw new BotError(`delete agent answered ${answer.status}`);
          }
        },
      ],
      [
        'session',
        async () => {
          if (state.cookie !== undefined) {
            await client.site('/v1/auth/logout', state.cookie, { method: 'POST', body: {} });
          }
        },
      ],
      [
        'streams',
        async () => {
          abort.abort();
          await Promise.allSettled(tasks);
        },
      ],
    ];
  }

  return {
    name,
    state,
    ended,
    provision,
    start,
    join,
    poolSize,
    leaveSteps,
    outcome: () => ({ name, room: state.roomId, stages: state.stages }),
  };
}

export { RateLimited };
