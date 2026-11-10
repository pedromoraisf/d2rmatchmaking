import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '@d2rmm/contracts';
import type { SiteStreamHandlers, StreamOpener } from '../shared/stream.ts';
import { createApiClient, type Fetcher } from '../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../test/fake-api.ts';
import { renderInLanguage } from '../test/render.tsx';
import { App } from './App.tsx';

afterEach(cleanup);

const config = { stagingEndpoints: true, minAgentVersion: '0.0.1' };
const player = { accountId: 'acc-1', displayName: 'PlayerOne' };
const pairedAgent = {
  status: 'paired',
  agentId: 'agent-1',
  online: false,
  gameRunning: false,
  screen: 'UNKNOWN',
  lastSeenAt: '2026-10-31T01:00:00Z',
};
const member: Member = { accountId: 'acc-1', characterId: null, joinOrder: 1, role: 'host' };
const room = {
  roomId: '4821',
  mode: 'leveling',
  activity: 'baal',
  difficulty: 'hell',
  stage: 'awaiting_host',
  run: 1,
  expectedGameName: 'mmbaalh-12',
  password: '',
  members: [member],
};

// Captures the handlers App hands to the stream, so a test plays the server's events.
function fakeStream() {
  const seen: { handlers?: SiteStreamHandlers; closed: number } = { closed: 0 };
  const openStream: StreamOpener = (handlers) => {
    seen.handlers = handlers;
    return () => {
      seen.closed += 1;
    };
  };
  return { openStream, seen };
}

async function playEvent(
  stream: ReturnType<typeof fakeStream>,
  event: Parameters<SiteStreamHandlers['onEvent']>[0],
) {
  await vi.waitFor(() => expect(stream.seen.handlers).toBeDefined());
  act(() => {
    stream.seen.handlers?.onEvent(event);
  });
}

// Opens the stream the way the browser does: the site reads the room again at once.
async function streamOpens(stream: ReturnType<typeof fakeStream>) {
  await vi.waitFor(() => expect(stream.seen.handlers).toBeDefined());
  act(() => {
    stream.seen.handlers?.onOpen();
  });
}

// Answers the room reads in call order: `answers[n]` answers read n + 1 at once. A read past the list is held until
// `release` answers the oldest held read. Every other URL goes through routeFetch.
function scriptedRoomReads(routes: Record<string, () => Response>, answers: Array<() => Response>) {
  const base = routeFetch(routes);
  const held: Array<(response: Response) => void> = [];
  let reads = 0;
  const fetch: Fetcher = (url, init) => {
    if (url !== '/api/v1/me/room') {
      return base.fetch(url, init);
    }
    reads += 1;
    const answer = answers[reads - 1];
    if (answer !== undefined) {
      return Promise.resolve(answer());
    }
    return new Promise<Response>((resolve) => {
      held.push(resolve);
    });
  };
  return {
    fetch,
    reads: () => reads,
    release: async (response: Response) => {
      const next = held.shift();
      if (next === undefined) {
        throw new Error('no held room read to release');
      }
      await act(async () => {
        next(response);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

function signedInRoutes(): Record<string, () => Response> {
  return {
    'GET /api/v1/config': () => jsonResponse(200, config),
    'GET /api/v1/me': () => jsonResponse(200, player),
    'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
  };
}

function roomReply(stage: string): Response {
  return jsonResponse(200, { ...room, stage });
}

describe('App', () => {
  it('shows Loading… until the configuration answers', () => {
    const client = createApiClient(() => new Promise<Response>(() => undefined));
    renderInLanguage(<App client={client} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows the error message when the configuration cannot be read', async () => {
    const { fetch } = routeFetch({ 'GET /api/v1/config': () => jsonResponse(500) });
    renderInLanguage(<App client={createApiClient(fetch)} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
  });

  it('shows the signed-out site with the sign-in form when /v1/me answers 401', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(401),
    });
    renderInLanguage(<App client={createApiClient(fetch)} />);
    expect(await screen.findByText('Sign in with a test account')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download the agent' })).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it('signs a visitor in on the site and shows the name', async () => {
    let signedIn = false;
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => (signedIn ? jsonResponse(200, player) : jsonResponse(401)),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(404),
      'POST /api/v1/auth/test-login': () => {
        signedIn = true;
        return jsonResponse(204);
      },
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    await screen.findByText('Sign in with a test account');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Player name'), 'PlayerOne');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as PlayerOne')).toBeTruthy();
  });

  it('hides the sign-in form when staging endpoints are off', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, { ...config, stagingEndpoints: false }),
      'GET /api/v1/me': () => jsonResponse(401),
    });
    renderInLanguage(<App client={createApiClient(fetch)} />);
    await screen.findByRole('link', { name: 'Download the agent' });
    expect(screen.queryByText('Sign in with a test account')).toBeNull();
  });

  it('shows the pairing form to a signed-in player without an agent', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    expect(await screen.findByText('Pairing code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair agent' })).toBeTruthy();
  });

  it('shows "Agent paired" after the player submits an accepted code', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'POST /api/v1/agents/pair': () => jsonResponse(200),
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Pairing code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Pair agent' }));
    expect((await screen.findByRole('status')).textContent).toBe('Agent paired');
  });

  it('switches from "Agent offline" to "Agent online" and "Game open" on a presence event', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, pairedAgent),
      'GET /api/v1/me/room': () => jsonResponse(404),
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    expect(await screen.findByText('Agent offline')).toBeTruthy();
    expect(screen.getByText('Game closed')).toBeTruthy();

    await playEvent(stream, {
      type: 'agent.presence_changed',
      data: { agentId: 'agent-1', online: true, gameRunning: true, screen: 'AUTOMAP_OPEN' },
    });
    expect(screen.getByText('Agent online')).toBeTruthy();
    expect(screen.getByText('Game open')).toBeTruthy();
    expect(screen.getByText('Screen: Automap open')).toBeTruthy();
  });

  it('lists a character the agent registers without a reload, on the characters.updated event', async () => {
    let listed: unknown[] = [];
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/characters': () => jsonResponse(200, { characters: listed }),
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    expect(
      await screen.findByText(
        'Open the character selection screen in the game with the agent running to add your characters.',
      ),
    ).toBeTruthy();

    listed = [
      {
        name: 'Sorc',
        class: 'sorceress',
        level: 85,
        ladder: 'sc-ladder',
        era: 'lod',
        unlockedDifficulties: ['normal', 'nightmare', 'hell'],
        readAt: '2026-11-10T12:00:00.000Z',
      },
    ];
    await playEvent(stream, { type: 'characters.updated', data: {} });

    expect(await screen.findByText('Sorc')).toBeTruthy();
  });

  it('shows the room the player was assigned, with its game name, "No password" and stage', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(200, room),
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    expect(await screen.findByText('mmbaalh-12')).toBeTruthy();
    expect(screen.getByText('No password')).toBeTruthy();
    expect(screen.getByText('Awaiting host')).toBeTruthy();
  });

  it('shows a room assigned on the stream as "Awaiting host" and then "Created" when its stage changes', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(404),
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    await screen.findByText('Pairing code');
    await playEvent(stream, {
      type: 'room.assigned',
      data: { roomId: '4821', run: 1, expectedGameName: 'mmbaalh-12', members: [member] },
    });
    expect(screen.getByText('mmbaalh-12')).toBeTruthy();
    expect(screen.getByText('Awaiting host')).toBeTruthy();

    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });

  it('a newer room replaces the room on screen', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(404),
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    await screen.findByText('Pairing code');
    await playEvent(stream, {
      type: 'room.assigned',
      data: { roomId: '4821', run: 1, expectedGameName: 'mmbaalh-12', members: [member] },
    });
    await playEvent(stream, {
      type: 'room.assigned',
      data: { roomId: '4822', run: 1, expectedGameName: 'mmbaalh-13', members: [member] },
    });
    expect(screen.getByText('mmbaalh-13')).toBeTruthy();
    expect(screen.queryByText('mmbaalh-12')).toBeNull();
  });

  it('re-reads the room on every stream open', async () => {
    const { fetch, calls } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(200, room),
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    const before = calls.filter((call) => call.url === '/api/v1/me/room').length;
    await vi.waitFor(() => expect(stream.seen.handlers).toBeDefined());
    act(() => {
      stream.seen.handlers?.onOpen();
    });
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/v1/me/room').length).toBe(before + 1),
    );
  });

  it('hides "Start test match" when staging endpoints are off', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, { ...config, stagingEndpoints: false }),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => jsonResponse(404),
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    await screen.findByText('Pairing code');
    expect(screen.queryByRole('button', { name: 'Start test match' })).toBeNull();
  });

  it('starts a test match and shows the room the re-read returns', async () => {
    let assigned = false;
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(200, player),
      'GET /api/v1/agents/me': () => jsonResponse(200, { status: 'none' }),
      'GET /api/v1/me/room': () => (assigned ? jsonResponse(200, room) : jsonResponse(404)),
      'POST /api/v1/staging/match-formed': () => {
        assigned = true;
        return jsonResponse(202);
      },
    });
    renderInLanguage(<App client={createApiClient(fetch)} openStream={fakeStream().openStream} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start test match' }));
    expect(await screen.findByText('mmbaalh-12')).toBeTruthy();
    expect(screen.getByText('Awaiting host')).toBeTruthy();
  });

  it('ignores a read that answers after a stream event', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    expect(screen.getByText('Created')).toBeTruthy();

    await reads.release(jsonResponse(200, room));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });

  it('reads again after ignoring a read', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    await reads.release(jsonResponse(200, room));

    await vi.waitFor(() => expect(reads.reads()).toBe(3));
    await reads.release(roomReply('created'));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });

  it('reads again when a read fails after a stream event', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });

    await reads.release(jsonResponse(500));
    await vi.waitFor(() => expect(reads.reads()).toBe(3));
    await reads.release(roomReply('created'));
    expect(screen.getByText('Created')).toBeTruthy();
  });

  it('ignores a test match read that answers after a stream event', async () => {
    const reads = scriptedRoomReads(
      { ...signedInRoutes(), 'POST /api/v1/staging/match-formed': () => jsonResponse(202) },
      [() => jsonResponse(404)],
    );
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start test match' }));
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.assigned',
      data: { roomId: '4821', run: 1, expectedGameName: 'mmbaalh-12', members: [member] },
    });
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    expect(screen.getByText('Created')).toBeTruthy();

    await reads.release(roomReply('awaiting_host'));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });

  it('a presence event during a read also makes the site read again', async () => {
    const reads = scriptedRoomReads(
      { ...signedInRoutes(), 'GET /api/v1/agents/me': () => jsonResponse(200, pairedAgent) },
      [() => roomReply('awaiting_host')],
    );
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'agent.presence_changed',
      data: { agentId: 'agent-1', online: true, gameRunning: true, screen: 'AUTOMAP_OPEN' },
    });

    await reads.release(roomReply('awaiting_host'));
    await vi.waitFor(() => expect(reads.reads()).toBe(3));
  });

  it('a repeated event during a read costs one more read', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });
    expect(screen.getByText('Created')).toBeTruthy();

    await reads.release(roomReply('awaiting_host'));
    await vi.waitFor(() => expect(reads.reads()).toBe(3));
    await reads.release(roomReply('created'));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
    expect(reads.reads()).toBe(3);
  });

  it('shows the answer of a read with no stream event during it and reads once', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));

    await reads.release(roomReply('created'));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(reads.reads()).toBe(2);
  });

  it('clears the room when a read answers no room and no stream event arrived', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));

    await reads.release(jsonResponse(404));
    expect(screen.queryByText('mmbaalh-12')).toBeNull();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });

  it('keeps the stage from the stream when the new read fails', async () => {
    const reads = scriptedRoomReads(signedInRoutes(), [() => roomReply('awaiting_host')]);
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(reads.fetch)} openStream={stream.openStream} />);
    await screen.findByText('mmbaalh-12');
    await streamOpens(stream);
    await vi.waitFor(() => expect(reads.reads()).toBe(2));
    await playEvent(stream, {
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created', members: [member] },
    });

    await reads.release(roomReply('awaiting_host'));
    await vi.waitFor(() => expect(reads.reads()).toBe(3));
    await reads.release(jsonResponse(500));
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.queryByText('Awaiting host')).toBeNull();
  });
});
