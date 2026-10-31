import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '@d2rmm/contracts';
import type { SiteStreamHandlers, StreamOpener } from '../shared/stream.ts';
import { createApiClient } from '../shared/api-client.ts';
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
});
