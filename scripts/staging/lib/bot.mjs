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

  /**
   * Holds one stream for the life of the bot and reconnects it. Resolves once it has opened for the first time: the API counts
   * the account's site stream and agent as connected only from then (INV-03). `onOpen` runs at each open, as a real agent
   * re-reads its state when its stream opens, because the stream replays only what carries an id.
   */
  function holdStream(label, headers, handle, onOpen) {
    let opened;
    const first = new Promise((resolve) => {
      opened = resolve;
    });
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
            opened();
            await onOpen?.();
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
    return first;
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
  const stagesByRoom = new Map();
  // Stage changes and assignments arrive on two streams; they are handled one at a time, in arrival order.
  let queue = Promise.resolve();
  const exclusive = (work) => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };
  const accepted = new Set();

  async function acceptReadyCheck(id) {
    if (accepted.has(id)) return;
    accepted.add(id);
    const [low, high] = ACCEPT_DELAY_MS;
    await sleep(low + random() * (high - low), abort.signal);
    const answer = await client.agent(`/v1/ready-checks/${encodeURIComponent(id)}/accept`, state.token, {
      method: 'POST',
      body: {},
    });
    say('bot.accepted', { status: answer.status });
  }

  async function takeAssignment(data) {
    await exclusive(async () => {
      if (state.roomId === data.roomId && state.run === data.run) return;
      assignment = data;
      state.roomId = assignment.roomId;
      state.run = assignment.run;
      state.pcState = 'IN_ROOM_JOINING';
      state.ticketId = undefined;
      state.stages = [];
      state.stage = undefined;
      say('bot.assigned', { room: assignment.roomId, host: isHost() });
      // A real agent beats at once when its state changes; the heartbeat that names the room is what moves it on (LBR-02).
      await heartbeat();
      // The site stream may have delivered stages of this room before this event: they were kept, and apply now, in order.
      for (const stage of [...(stagesByRoom.get(assignment.roomId) ?? [])]) await applyStage(stage);
    });
  }

  async function onAgentEvent(event) {
    if (event.type === 'ready_check.started') {
      await acceptReadyCheck(event.data.id);
    } else if (event.type === 'room.assigned' || event.type === 'room.run_opened') {
      await takeAssignment(event.data);
    } else if (event.type === 'room.stage_changed') {
      // The agent's stream carries only the end of a room (closed or expired); the site's carries every stage.
      await onStage(event.data);
    }
  }

  /** What a real agent reads when its stream opens: its open ready check and its assignment (RDY-11). */
  async function catchUpAgent() {
    const check = await client.agent('/v1/ready-checks/me', state.token);
    if (check.status === 200 && check.body?.id !== undefined)
      void acceptReadyCheck(check.body.id).catch(() => undefined);
    const held = await client.agent('/v1/agents/me/assignment', state.token);
    if (held.status === 200 && held.body?.roomId !== undefined) await takeAssignment(held.body);
  }

  /** What the site reads when its stream opens: the room it is in, so a stage that went by is not lost. */
  async function catchUpSite() {
    const room = await client.site('/v1/me/room', state.cookie);
    if (room.status === 200 && room.body?.roomId !== undefined) {
      await onStage({ roomId: room.body.roomId, stage: room.body.stage });
    }
  }

  const isHost = () =>
    assignment?.members.find((member) => member.accountId === state.accountId)?.role === 'host';

  /**
   * A stage change of a room. The two streams are not ordered against each other, so a stage is kept by room and applied once
   * the bot knows the room (on its `room.assigned`); until then nothing is lost. Changes apply one at a time.
   */
  async function onStage(change) {
    await exclusive(async () => {
      const seen = stagesByRoom.get(change.roomId) ?? [];
      if (seen.at(-1) !== change.stage) seen.push(change.stage);
      stagesByRoom.set(change.roomId, seen);
      if (change.roomId === state.roomId) await applyStage(change.stage);
    });
  }

  /**
   * The assignment as the API holds it now. The roles in the `room.assigned` event are not reliable when it arrives (a CI run
   * showed both members of a duel as `member` and the room waiting for a host forever), so the bot reads them again at the
   * stages that depend on who hosts.
   */
  async function refreshAssignment() {
    const held = await client.agent('/v1/agents/me/assignment', state.token);
    if (held.status === 200 && held.body?.roomId === state.roomId && held.body?.run === state.run) {
      assignment = held.body;
    }
  }

  /**
   * What a stage asks of the bot. The host posts the game name once the room awaits it (`awaiting_host`): posted earlier, the
   * API would take it and not move the room, and the same key could not be sent again. A member posts once the game is created.
   */
  async function applyStage(stage) {
    if (state.stages.at(-1) === stage) return;
    state.stage = stage;
    state.stages.push(stage);
    say('bot.stage', { stage });
    if (stage === 'awaiting_host' || stage === 'created') await refreshAssignment();
    if (stage === 'awaiting_host' && isHost() && plan.hostPolicy === 'bot-reports') await observe(assignment);
    if (stage === 'created' && !isHost()) await observe(assignment);
    if (ENDED_STAGES.has(stage)) {
      state.ended = true;
      state.pcState = 'IDLE';
      onEnded();
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

  /**
   * Brings the bot online: the first heartbeat, then the site stream and the agent stream, and returns once both are open. The
   * queue refuses a join until the agent is online and the site is connected (INV-03), so the join waits for this.
   */
  async function start() {
    await heartbeat();
    keepAlive(heartbeat, HEARTBEAT_EVERY_MS);
    const site = holdStream(
      'site',
      { Cookie: state.cookie },
      async (event) => {
        if (event.type === 'room.stage_changed') await onStage(event.data);
      },
      catchUpSite,
    );
    const agentStream = holdStream(
      'agent',
      { Authorization: `Bearer ${state.token}`, 'X-Agent-Version': client.version },
      onAgentEvent,
      catchUpAgent,
    );
    await Promise.all([site, agentStream]);
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
