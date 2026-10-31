import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../test/fake-api.ts';
import { renderInLanguage } from '../test/render.tsx';
import { App } from './App.tsx';

afterEach(cleanup);

const config = { stagingEndpoints: true, minAgentVersion: '0.0.1' };
const player = { accountId: 'acc-1', displayName: 'PlayerOne' };

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
      'POST /api/v1/auth/test-login': () => {
        signedIn = true;
        return jsonResponse(204);
      },
    });
    renderInLanguage(<App client={createApiClient(fetch)} />);
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
});
