import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    });
    const stream = fakeStream();
    renderInLanguage(<App client={createApiClient(fetch)} openStream={stream.openStream} />);
    expect(await screen.findByText('Agent offline')).toBeTruthy();
    expect(screen.getByText('Game closed')).toBeTruthy();

    await vi.waitFor(() => expect(stream.seen.handlers).toBeDefined());
    act(() => {
      stream.seen.handlers?.onEvent({
        type: 'agent.presence_changed',
        data: { agentId: 'agent-1', online: true, gameRunning: true, screen: 'AUTOMAP_OPEN' },
      });
    });
    expect(screen.getByText('Agent online')).toBeTruthy();
    expect(screen.getByText('Game open')).toBeTruthy();
    expect(screen.getByText('Screen: Automap open')).toBeTruthy();
  });
});
