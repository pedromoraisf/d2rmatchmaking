import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../test/fake-api.ts';
import { renderInLanguage } from '../test/render.tsx';
import { App } from './App.tsx';

afterEach(cleanup);

const config = { stagingEndpoints: true, minAgentVersion: '0.0.1' };

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

  it('shows the signed-out site with the notice when /v1/me answers 401', async () => {
    const { fetch } = routeFetch({
      'GET /api/v1/config': () => jsonResponse(200, config),
      'GET /api/v1/me': () => jsonResponse(401),
    });
    renderInLanguage(<App client={createApiClient(fetch)} />);
    expect(await screen.findByRole('link', { name: 'Download the agent' })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});
