import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { SignInPanel } from './SignInPanel.tsx';

afterEach(cleanup);

const me = { accountId: 'acc-1', displayName: 'PlayerOne' };

describe('SignInPanel', () => {
  it('is not shown when staging endpoints are off', () => {
    renderInLanguage(
      <SignInPanel client={createApiClient()} staging={false} session={null} onSignedIn={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByText('Sign in with a test account')).toBeNull();
  });

  it('shows the signed-in name for a session', () => {
    renderInLanguage(<SignInPanel client={createApiClient()} staging session={me} onSignedIn={vi.fn()} />);
    expect(screen.getByText('Signed in as PlayerOne')).toBeTruthy();
  });

  it('refuses a name outside the rules, shows the reason and stays signed out', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/auth/test-login': () => jsonResponse(400) });
    const onSignedIn = vi.fn();
    renderInLanguage(
      <SignInPanel client={createApiClient(fetch)} staging session={null} onSignedIn={onSignedIn} />,
    );
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
    renderInLanguage(
      <SignInPanel client={createApiClient(fetch)} staging session={null} onSignedIn={onSignedIn} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Player name'), 'PlayerOne');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(me));
  });
});
