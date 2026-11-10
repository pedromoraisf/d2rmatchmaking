import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { SignInPanel } from './SignInPanel.tsx';

afterEach(cleanup);

const me = { accountId: 'acc-1', displayName: 'PlayerOne' };

/** The panel with the flags of a site that has no Battle.net and no failure; each test overrides what it needs. */
function panel(overrides: Partial<ComponentProps<typeof SignInPanel>> = {}) {
  const props = {
    client: createApiClient(),
    staging: true,
    bnetSignIn: false,
    bnetFailed: false,
    session: null,
    onSignedIn: vi.fn(),
    onSignedOut: vi.fn(),
    ...overrides,
  };
  renderInLanguage(<SignInPanel {...props} />);
  return props;
}

describe('SignInPanel', () => {
  it('is not shown when staging endpoints are off', () => {
    panel({ staging: false });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByText('Sign in with a test account')).toBeNull();
  });

  it('shows the signed-in name for a session', () => {
    panel({ session: me });
    expect(screen.getByText('Signed in as PlayerOne')).toBeTruthy();
  });

  it('refuses a name outside the rules, shows the reason and stays signed out', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/auth/test-login': () => jsonResponse(400) });
    const onSignedIn = vi.fn();
    panel({ client: createApiClient(fetch), onSignedIn });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Player name'), ' PlayerOne');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Use 2 to 16 letters, digits or hyphens.');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('reports the signed-in player once the test sign-in and /v1/me succeed', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/auth/test-login': () => jsonResponse(204),
      'GET /api/v1/me': () => jsonResponse(200, me),
    });
    const onSignedIn = vi.fn();
    panel({ client: createApiClient(fetch), onSignedIn });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Player name'), 'PlayerOne');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(me));
  });

  it('offers the Battle.net sign-in as a link to the API login route when the API has the credentials', () => {
    panel({ bnetSignIn: true });
    const link = screen.getByRole('link', { name: 'Sign in with Battle.net' });
    expect(link.getAttribute('href')).toBe('/api/v1/auth/bnet/login');
  });

  it('offers no Battle.net link when the API has no credentials', () => {
    panel({ bnetSignIn: false });
    expect(screen.queryByRole('link', { name: 'Sign in with Battle.net' })).toBeNull();
  });

  it('keeps the Battle.net link reachable by keyboard', async () => {
    panel({ bnetSignIn: true, staging: false });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Sign in with Battle.net' }));
  });

  it('shows the Battle.net failure message after a refused sign-in', () => {
    panel({ bnetSignIn: true, bnetFailed: true });
    expect(screen.getByRole('alert').textContent).toBe('Sign-in with Battle.net failed. Please try again.');
    expect(screen.getByRole('link', { name: 'Sign in with Battle.net' })).toBeTruthy();
  });

  it('signs out: posts the sign-out and reports the visitor signed out', async () => {
    const { fetch, calls } = routeFetch({ 'POST /api/v1/auth/logout': () => jsonResponse(204) });
    const onSignedOut = vi.fn();
    panel({ client: createApiClient(fetch), session: me, onSignedOut });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toStrictEqual([
      'POST /api/v1/auth/logout',
    ]);
  });

  it('signs out from the keyboard: the button takes focus and answers Enter', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/auth/logout': () => jsonResponse(204) });
    const onSignedOut = vi.fn();
    panel({ client: createApiClient(fetch), session: me, onSignedOut });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign out' }));
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  });

  it('treats an already expired session as signed out', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/auth/logout': () => jsonResponse(401) });
    const onSignedOut = vi.fn();
    panel({ client: createApiClient(fetch), session: me, onSignedOut });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  });

  it('shows the error message and stays signed in when sign-out fails', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/auth/logout': () => jsonResponse(500) });
    const onSignedOut = vi.fn();
    panel({ client: createApiClient(fetch), session: me, onSignedOut });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.getByText('Signed in as PlayerOne')).toBeTruthy();
  });
});
