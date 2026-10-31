import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { StartTestMatchButton } from './StartTestMatchButton.tsx';

afterEach(cleanup);

describe('StartTestMatchButton', () => {
  it('posts a test match on click and reports that it started', async () => {
    const { fetch, calls } = routeFetch({ 'POST /api/v1/staging/match-formed': () => jsonResponse(202) });
    const onStarted = vi.fn();
    renderInLanguage(<StartTestMatchButton client={createApiClient(fetch)} onStarted={onStarted} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start test match' }));
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    expect(calls.map((call) => call.url)).toStrictEqual(['/api/v1/staging/match-formed']);
  });

  it('shows the error message and does not report a started match when the API refuses', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/staging/match-formed': () => jsonResponse(500) });
    const onStarted = vi.fn();
    renderInLanguage(<StartTestMatchButton client={createApiClient(fetch)} onStarted={onStarted} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start test match' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
    expect(onStarted).not.toHaveBeenCalled();
  });
});
